import { readFile, readdir } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import type { Dirent } from 'fs'
import { join, resolve, relative, sep } from 'path'

// Read-only source access for the AI's code tools. No Electron in here, so the
// path confinement and the walk can be tested directly.
//
// Everything is async on purpose. These run in Electron's MAIN process, whose
// event loop also serves IPC and the window controls: measured on a large tree,
// the sync version blocked it for ~73ms to walk to the cap and ~640ms more to
// read the files for a search. Async fs hands the syscalls to libuv's pool and
// yields between entries, so the main thread stays responsive.
//
// A worker_thread would also work but buys nothing here — this is IO-bound, and
// the syscalls already leave the main thread with async fs. A worker would add a
// second bundle entry, message passing and a lifecycle to get the same result.

/** Directories never worth walking into for source search. */
export const CODE_IGNORE = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.git',
  '.vite',
  '.next',
  '.turbo'
])

/**
 * Load and parse .gitignore patterns from root. Returns a list of ignore
 * patterns that apply to relative paths. Best-effort — unreadable/missing
 * .gitignore = no extra filtering.
 */
function loadGitignore(root: string): string[] {
  const gitignorePath = join(root, '.gitignore')
  if (!existsSync(gitignorePath)) return []
  try {
    const content = readFileSync(gitignorePath, 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
      .map((l) => (l.startsWith('/') ? l.slice(1) : l))
      .map((l) => (l.endsWith('/') ? l.slice(0, -1) : l))
  } catch {
    return []
  }
}

/** Check if a relative path matches any gitignore pattern (simple prefix match). */
function matchesGitignore(relPath: string, patterns: string[]): boolean {
  if (!patterns.length) return false
  for (const p of patterns) {
    // Directory wildcard: foo/ matches any path containing foo/ or ending with foo
    if (p.includes('*')) {
      const [pre, post] = p.split('*', 2)
      if (!pre && post) { if (relPath.endsWith(post) || relPath.includes('/' + post)) return true }
      else if (pre && !post) { if (relPath.startsWith(pre)) return true }
      else if (pre && post) { if (relPath.startsWith(pre) && relPath.endsWith(post)) return true }
    } else {
      // Exact match or path segment match
      if (relPath === p || relPath.startsWith(p + '/') || relPath.includes('/' + p + '/')) return true
    }
  }
  return false
}

/**
 * Resolve `rel` under `root`, or null if it escapes.
 *
 * This is the only thing standing between the assistant and the rest of the
 * disk: every path the code tools touch goes through here.
 */
export function confineToRoot(root: string, rel: string): string | null {
  const base = resolve(root)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

export interface WalkResult {
  files: string[]
  /** True when the cap cut the listing short — there is more down there. */
  truncated: boolean
}

/**
 * Every file under `root/sub`, relative to `root`, up to `cap`.
 *
 * Awaits each readdir, so the event loop is free between directories.
 */
export async function walkFiles(root: string, sub: string, cap: number): Promise<WalkResult> {
  const files: string[] = []
  const start = confineToRoot(root, sub)
  let truncated = false
  if (!start) return { files, truncated }

  const base = resolve(root)
  const gitignorePatterns = loadGitignore(root)
  const stack = [start]
  while (stack.length && files.length < cap) {
    const dir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (files.length >= cap) {
        truncated = true
        break
      }
      if (e.isDirectory()) {
        if (CODE_IGNORE.has(e.name) || e.name.startsWith('.')) continue
        const relPath = relative(base, join(dir, e.name)).replace(/\\/g, '/')
        if (matchesGitignore(relPath, gitignorePatterns)) continue
        stack.push(join(dir, e.name))
      } else if (e.isFile()) {
        const relPath = relative(base, join(dir, e.name)).replace(/\\/g, '/')
        if (matchesGitignore(relPath, gitignorePatterns)) continue
        files.push(relPath)
      }
    }
  }
  if (stack.length) truncated = true
  return { files: files.sort(), truncated }
}

// ---------------------------------------------------------------------------
// Scoped reading — return only the part of a file the model asked for.
//
// A whole file is resent to the model on every later step of a run, so reading
// a 60k-char module to answer a question about one function is a per-step tax
// paid for a slice. These helpers let `ler_arquivo` ask for a named symbol or a
// line range and get back ~1-3k chars instead of a 20k window paged five times.
//
// All best-effort and regex-based on purpose: an AST parse would need a
// language-aware toolchain per file type, and the model tolerates an imperfect
// slice far better than the main process tolerates a heavy dependency. Pure and
// tested in code-files.test.ts.
// ---------------------------------------------------------------------------

/** Ceiling on the lines a single symbol extraction returns, before it's capped. */
export const SYMBOL_MAX_LINES = 400

/** A declaration surfaced by detectSymbols — a jump target for extractSymbol. */
export interface DetectedSymbol {
  nome: string
  /** 1-based line where the declaration starts. */
  linha: number
  /** function | class | const | let | var | interface | type | enum */
  tipo: string
}

/** The source of a named symbol or a line range, with its 1-based bounds. */
export interface ScopeResult {
  content: string
  /** 1-based line the slice starts at. */
  linhaInicio: number
  /** 1-based line the slice ends at (inclusive). */
  linhaFim: number
}

/** Escape a user/model string so it's safe to splice into a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Top-level / exported declarations in `content`, as a lightweight map the model
 * can read to jump straight to the one it needs (via extractSymbol) instead of
 * paging the whole file. Regex over the start of each line, best-effort: it sees
 * declarations, not an AST, and stops at `cap` so a huge file can't flood the
 * result it's meant to shrink.
 */
export function detectSymbols(content: string, cap = 80): DetectedSymbol[] {
  const out: DetectedSymbol[] = []
  const lines = content.split('\n')
  // Anchored at column 0 (no leading whitespace) on purpose: top-level and
  // exported declarations only, not a nested `const` inside some function body —
  // this is a jump map, and the nested ones are noise the model can't target.
  const re =
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    const m = re.exec(lines[i])
    if (m) out.push({ nome: m[2], linha: i + 1, tipo: m[1].startsWith('function') ? 'function' : m[1] })
  }
  return out
}

/**
 * The source of a named symbol (function/class/const/interface/method), located
 * by regex and bounded by naive brace matching. `null` when the name isn't found
 * as a declaration.
 *
 * Best-effort, not an AST: it takes the first *declaration-looking* line for the
 * name (a bare call site won't match, but a same-named field might), and the
 * brace counter does not understand braces inside strings or comments. For a
 * block-less statement (`const x = 5;`, a `type` alias) it ends at the first
 * `;`, and it never returns more than SYMBOL_MAX_LINES.
 */
export function extractSymbol(content: string, symbol: string): ScopeResult | null {
  const name = symbol.trim()
  if (!name) return null
  const lines = content.split('\n')
  const s = escapeRe(name)
  const decl = [
    new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?function\\*?\\s+${s}\\b`),
    new RegExp(`^(export\\s+)?(default\\s+)?(abstract\\s+)?class\\s+${s}\\b`),
    new RegExp(`^(export\\s+)?(const|let|var)\\s+${s}\\b`),
    new RegExp(`^(export\\s+)?(default\\s+)?(interface|type|enum)\\s+${s}\\b`),
    // A class method with its body brace on the same line: `foo(...) {`,
    // `async foo(): T {`. The trailing `{` is what tells a definition from a
    // bare call site (`foo()`), which must NOT match.
    new RegExp(`^(public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|async\\s+|get\\s+|set\\s+)*${s}\\s*\\([^)]*\\)\\s*(:[^{]*)?\\{`),
    // An assigned arrow/value: `foo = (...) => …`, `foo = bar`.
    new RegExp(`^(public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+)*${s}\\s*=`)
  ]
  let declLine = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (decl.some((re) => re.test(t))) {
      declLine = i
      break
    }
  }
  if (declLine === -1) return null

  let end = declLine
  let brace = 0
  let started = false
  const cap = Math.min(lines.length, declLine + SYMBOL_MAX_LINES)
  for (let i = declLine; i < cap; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        brace++
        started = true
      } else if (ch === '}') brace--
    }
    end = i
    if (started) {
      if (brace <= 0) break
    } else if (lines[i].includes(';')) {
      break
    } else if (i > declLine && lines[i].trim() === '') {
      // Block-less decl that ran to a blank line without a ';' — stop above it.
      end = i - 1
      break
    }
  }
  return { content: lines.slice(declLine, end + 1).join('\n'), linhaInicio: declLine + 1, linhaFim: end + 1 }
}

// ---------------------------------------------------------------------------
// Shared search — used by both the IPC handler (chat agent) and the native
// code agent. Extracted so the two don't drift apart.
// ---------------------------------------------------------------------------

/** One match found by searchFiles. */
export interface SearchMatch {
  file: string
  line: number
  text: string
  /** Lines before the match (only when contexto > 0). */
  antes?: string
  /** Lines after the match (only when contexto > 0). */
  depois?: string
}

/** Result of a searchFiles call. */
export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

/** Options for searchFiles. */
export interface SearchOptions {
  /** Max matches to return (default 60). */
  cap?: number
  /** Lines of context before/after each match (default 0). */
  contexto?: number
  /** Glob-like include filter (e.g. "*.ts"). */
  incluir?: string
  /** Glob-like exclude filter (e.g. "*.test.ts"). */
  excluir?: string
}

/**
 * Search files under `root` for `termo` (case-insensitive substring).
 * Shared between the chat agent's IPC handler and the native code agent.
 */
export async function searchFiles(
  root: string,
  termo: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  const { files } = await walkFiles(root, '.', 3000)
  const cap = opts.cap ?? 60
  const contexto = opts.contexto ?? 0
  const incluir = opts.incluir ?? ''
  const excluir = opts.excluir ?? ''

  const filtered = files.filter((rel) => {
    if (incluir && !rel.endsWith(incluir.slice(1))) return false
    if (excluir && rel.endsWith(excluir.slice(1))) return false
    return true
  })

  const lower = termo.toLowerCase()
  const matches: SearchMatch[] = []

  for (const rel of filtered) {
    if (matches.length >= cap) break
    let content: string
    try {
      content = await readFile(join(resolve(root), rel), 'utf-8')
    } catch {
      continue
    }
    if (content.includes('\u0000')) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length && matches.length < cap; i++) {
      if (lines[i].toLowerCase().includes(lower)) {
        const m: SearchMatch = {
          file: rel,
          line: i + 1,
          text: lines[i].trim().slice(0, 200)
        }
        if (contexto > 0) {
          const antes = lines.slice(Math.max(0, i - contexto), i)
          m.antes = antes.map((l) => l.trim()).join('\n')
          const depois = lines.slice(i + 1, i + 1 + contexto)
          m.depois = depois.map((l) => l.trim()).join('\n')
        }
        matches.push(m)
      }
    }
  }

  return { matches, truncated: matches.length >= cap }
}

/**
 * Lines `from`..`to` of `content`, 1-based and inclusive. An omitted `from`
 * starts at line 1, an omitted `to` runs to the end; both are clamped into
 * range, and `to` can't fall below `from`.
 */
export function extractLines(content: string, from?: number, to?: number): ScopeResult {
  const lines = content.split('\n')
  const total = lines.length
  let start = typeof from === 'number' && Number.isFinite(from) && from >= 1 ? Math.floor(from) : 1
  let end = typeof to === 'number' && Number.isFinite(to) && to >= 1 ? Math.floor(to) : total
  start = Math.min(start, total)
  end = Math.min(Math.max(end, start), total)
  return { content: lines.slice(start - 1, end).join('\n'), linhaInicio: start, linhaFim: end }
}
