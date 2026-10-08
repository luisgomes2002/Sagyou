import type { IpcMain } from 'electron'

interface CodeFilesHandlerDeps {
  files: Pick<
    typeof import('../code-files'),
    | 'confineToRoot'
    | 'walkFiles'
    | 'detectSymbols'
    | 'extractSymbol'
    | 'extractLines'
    | 'searchFiles'
  >
  fs: Pick<typeof import('fs'), 'existsSync' | 'statSync' | 'readFileSync'>
}

export function registerCodeFilesHandlers(ipcMain: IpcMain, deps: CodeFilesHandlerDeps): void {
  // --- Read-only code access (for the assistant to analyze source) ---
  // Every path is confined to `root`; nothing outside it can be read.
  ipcMain.handle(
    'ai:code:list',
    async (_, root: string, sub?: string, offset?: number, limit?: number) => {
      if (!root || !deps.fs.existsSync(root)) return { error: 'Diretório inválido' }
      // A listing is resent to the model on every later step, and a project with
      // several roots fans out — hundreds of paths per step. So walk up to a
      // ceiling to know a real `total`, then return one CODE_LIST_PAGE window;
      // `limit` can raise it to CODE_LIST_MAX (the old flat cap) and `offset`
      // pages through the rest. Same shape as ai:code:read.
      const CODE_LIST_WALK = 2000
      const CODE_LIST_PAGE = 200
      const CODE_LIST_MAX = 400
      const { files, truncated: walkTruncated } = await deps.files.walkFiles(
        root,
        sub || '.',
        CODE_LIST_WALK
      )
      const total = files.length
      let page = CODE_LIST_PAGE
      if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 1) {
        page = Math.min(Math.floor(limit), CODE_LIST_MAX)
      }
      let start = 0
      if (typeof offset === 'number' && Number.isFinite(offset) && offset > 0) {
        start = Math.min(Math.floor(offset), total)
      }
      const slice = files.slice(start, start + page)
      const end = start + slice.length
      const morePages = end < total
      return {
        files: slice,
        total,
        offset: start,
        // True when there is more than this page shows — either more to page
        // through (nextOffset) or the walk itself hit its ceiling (narrow with
        // subpasta). Mirrors ler_arquivo's boolean "there's more".
        truncated: morePages || walkTruncated,
        ...(morePages ? { nextOffset: end } : {})
      }
    }
  )

  ipcMain.handle(
    'ai:code:read',
    (
      _,
      root: string,
      rel: string,
      offset?: number,
      maxChars?: number,
      // Scoped reading: a named symbol or a line range, so a big file can answer
      // a question about one function without shipping (and re-shipping) all of
      // it. When set, this wins over the char-window paging below.
      scope?: { symbol?: string; lineStart?: number; lineEnd?: number }
    ) => {
      const full = deps.files.confineToRoot(root, rel)
      if (!full || !deps.fs.existsSync(full) || !deps.fs.statSync(full).isFile()) {
        return { error: 'Arquivo inválido ou fora do projeto' }
      }
      const CODE_READ_PAGE = 20000
      const CODE_READ_MAX = 60000
      try {
        const content = deps.fs.readFileSync(full, 'utf-8')
        const total = content.length

        // --- Scoped mode: return just the symbol / line range asked for. ---
        if (scope && (scope.symbol || scope.lineStart != null || scope.lineEnd != null)) {
          const cap = (r: { content: string; linhaInicio: number; linhaFim: number }): object => {
            const truncated = r.content.length > CODE_READ_MAX
            return {
              content: truncated ? r.content.slice(0, CODE_READ_MAX) : r.content,
              linhaInicio: r.linhaInicio,
              linhaFim: r.linhaFim,
              truncated,
              total
            }
          }
          if (scope.symbol) {
            const found = deps.files.extractSymbol(content, scope.symbol)
            if (!found) {
              // Not a declaration in this file — hand back the symbol map so the
              // model can pick a real one instead of paging blindly.
              return {
                error: `Símbolo "${scope.symbol}" não encontrado`,
                total,
                simbolos: deps.files.detectSymbols(content)
              }
            }
            return { simbolo: scope.symbol, ...cap(found) }
          }
          return cap(deps.files.extractLines(content, scope.lineStart, scope.lineEnd))
        }

        // --- Big-file guard: a *blind* read (no scope, no offset, no explicit
        // max_chars) of a file too big to fit one page returns a short head plus
        // the symbol map and a nudge, instead of a full 20k window resent every
        // later step. It forces the model onto the surgical tools that already
        // exist — a named symbol, a line range, or paging with `inicio`. An
        // explicit `offset` or `max_chars` means the model already knows what it
        // wants, so those bypass this. (The 5000-line spec threshold was a no-op
        // here — kanban.ts is ~1k lines — so the real "big" measure is the same
        // char boundary the paging already uses.) ---
        const offsetProvided = typeof offset === 'number' && Number.isFinite(offset) && offset > 0
        const maxCharsProvided =
          typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1
        if (!offsetProvided && !maxCharsProvided && total > CODE_READ_PAGE) {
          const PREVIEW_LINES = 100
          const head = deps.files.extractLines(content, 1, PREVIEW_LINES)
          // Cap the head too, in case 100 lines are themselves huge (minified).
          const preview =
            head.content.length > CODE_READ_PAGE
              ? head.content.slice(0, CODE_READ_PAGE)
              : head.content
          return {
            content: preview,
            truncated: true,
            offset: 0,
            total,
            simbolos: deps.files.detectSymbols(content),
            nextOffset: preview.length,
            dica:
              `Arquivo grande (${total} chars). Para economizar tokens, mire o trecho: use ` +
              `"simbolo", "linha_inicio"/"linha_fim", ou pagine com "inicio"=${preview.length}. ` +
              `Passe "max_chars" para ler uma janela maior de uma vez.`
          }
        }

        // --- Char-window paging (unchanged): default 20k, raisable, resumable. ---
        // A file result is resent to the model on every later step, so a 60k-char
        // file (~15k tokens) was a per-step tax for a question that usually needs
        // a fraction of it. Default to one CODE_READ_PAGE window; `maxChars` can
        // raise it up to CODE_READ_MAX, and `offset` pages through the rest.
        let page = CODE_READ_PAGE
        if (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1) {
          page = Math.min(Math.floor(maxChars), CODE_READ_MAX)
        }
        let start = 0
        if (typeof offset === 'number' && Number.isFinite(offset) && offset > 0) {
          start = Math.min(Math.floor(offset), total)
        }
        const slice = content.slice(start, start + page)
        const end = start + slice.length
        const truncated = end < total
        return {
          content: slice,
          truncated,
          offset: start,
          total,
          // A symbol map, but only when it earns its tokens: on the first page of
          // a file too big to return whole. For a small file returned in full the
          // map is redundant (the model already has every line); on a big one it
          // lets the model re-read just the symbol it needs via `simbolo`.
          ...(truncated && start === 0 ? { simbolos: deps.files.detectSymbols(content) } : {}),
          // Where a follow-up read should resume; absent once the file is exhausted.
          ...(truncated ? { nextOffset: end } : {})
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Falha ao ler o arquivo' }
      }
    }
  )

  ipcMain.handle('ai:code:search', async (_, root: string, term: string) => {
    if (!root || !deps.fs.existsSync(root)) return { error: 'Diretório inválido' }
    if (!term) return { error: 'Termo vazio' }
    const result = await deps.files.searchFiles(root, term)
    return { matches: result.matches, truncated: result.truncated }
  })
}
