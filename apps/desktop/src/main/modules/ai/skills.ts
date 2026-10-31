// User-written Skills — .md files under the skills/ directory, injected into
// the chat by typing /skill-name. Core functions are file I/O only and testable
// with a temp dir; the one Electron import is the file dialog in `importSkill`.
//
// Unlike the old template system (ai-templates.json), skills are plain .md
// files: one file = one skill, the filename (minus .md) is its identifier.

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { dialog } from 'electron'

export interface Skill {
  /** The filename without .md — doubles as the id and the /command name. */
  name: string
  /** The full markdown body. */
  body: string
  /** ISO string of the file's last modified time. */
  updatedAt: string
}

/**
 * Absolute path to the skills directory.
 *
 * `basePath` is what to join with 'skills' — typically app.getPath('userData').
 * Injectable so tests can point at a temp dir without stubbing the filesystem.
 */
export function skillsDir(basePath: string): string {
  return join(basePath, 'skills')
}

/**
 * List every .md file in the skills directory.
 *
 * A missing dir is not an error — it means the user has no skills yet.
 * Non-.md files are ignored (the user may have dropped a README or notes
 * in there).
 */
export function listSkills(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f): Skill => {
      const p = join(dir, f)
      const body = readFileSync(p, 'utf-8')
      const updatedAt = statSync(p).mtime.toISOString()
      return { name: basename(f, '.md'), body, updatedAt }
    })
    .filter((s) => s.name.trim() !== '')
}

/**
 * Write (or overwrite) a skill file.
 *
 * Rejects empty names and empty bodies — an unnamed skill can't be called
 * with /, and an empty body sends nothing to the model.
 *
 * `oldName` is the previous name when renaming, so the old .md gets deleted.
 */
export function saveSkill(
  dir: string,
  input: { name: string; body: string; oldName?: string }
): { skill: Skill } | { error: string } {
  const name = (input.name ?? '').trim()
  const body = (input.body ?? '').trim()
  if (!name) return { error: 'A skill precisa de um nome' }
  if (!body) return { error: 'A skill não pode estar vazia' }

  mkdirSync(dir, { recursive: true })
  const p = join(dir, name + '.md')
  writeFileSync(p, body, 'utf-8')

  // If the name changed, delete the old file so we don't leave a stale copy.
  const oldName = (input.oldName ?? '').trim()
  if (oldName && oldName.toLowerCase() !== name.toLowerCase()) {
    const oldPath = join(dir, oldName + '.md')
    if (existsSync(oldPath)) unlinkSync(oldPath)
  }

  const updatedAt = statSync(p).mtime.toISOString()
  return { skill: { name, body, updatedAt } }
}

/**
 * Delete a skill file by name. Silent if it doesn't exist — the outcome is
 * the same (it's gone).
 */
export function deleteSkill(dir: string, name: string): void {
  const p = join(dir, name + '.md')
  if (existsSync(p)) unlinkSync(p)
}

/**
 * Open a file dialog for the user to pick a .md file, read it, and save it
 * as a skill with the same name. This is the only function that touches
 * Electron directly — the dialog is inherently a UI call.
 */
export async function importSkill(dir: string): Promise<{ skill: Skill } | { error: string }> {
  const result = await dialog.showOpenDialog({
    title: 'Importar skill (.md)',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { error: 'Nenhum arquivo selecionado' }
  }

  const filePath = result.filePaths[0]
  const body = readFileSync(filePath, 'utf-8').trim()
  if (!body) return { error: 'O arquivo está vazio' }

  const name = basename(filePath, '.md').trim()
  if (!name) return { error: 'Nome do arquivo inválido' }

  mkdirSync(dir, { recursive: true })
  const dest = join(dir, name + '.md')
  writeFileSync(dest, body, 'utf-8')

  const updatedAt = statSync(dest).mtime.toISOString()
  return { skill: { name, body, updatedAt } }
}
