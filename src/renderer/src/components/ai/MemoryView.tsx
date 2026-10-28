import { useCallback, useEffect, useState } from 'react'
import { useKanbanStore } from '../../store/kanban'
import type { AiMemory, MemoryType } from '../../types'
import { searchFocusClass } from '../../utils/searchFocus'

// The memory control panel: see, pin, restore and delete the durable facts the
// assistant accumulated. Reads through window.electronAPI.ai.memory.* (the store
// lives in the main process, outside the Zustand store — like AIView reads chat
// history), so it never touches useKanbanStore except to name a memory's project.

const TYPE_LABEL: Record<MemoryType, string> = {
  decisao: 'Decisão',
  tradeoff: 'Trade-off',
  gotcha: 'Armadilha',
  fato: 'Fato',
  handoff: 'Sessão',
  planejamento: 'Planejamento'
}

const TYPE_COLOR: Record<MemoryType, string> = {
  decisao: '#a080f0',
  tradeoff: '#f0b820',
  gotcha: '#ec6a6a',
  fato: '#999999',
  handoff: '#46d478',
  planejamento: '#a080f0'
}

const PAGE_SIZE = 25

type MemoryPage = Awaited<ReturnType<typeof window.electronAPI.ai.memory.page>>

export function MemoryView({ searchTargetId }: { searchTargetId?: string }): React.JSX.Element {
  const projects = useKanbanStore((s) => s.projects)
  // Main pages the corpus; only the visible page and the counts reach the screen.
  const [page, setPage] = useState<MemoryPage | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const projectName = useCallback(
    (id: string | null): string =>
      id ? (projects.find((p) => p.id === id)?.name ?? 'projeto removido') : 'global',
    [projects]
  )

  // setState lives in the promise callbacks (not after an await), matching
  // AIView's refresh helpers — that's what keeps it off react-hooks/
  // set-state-in-effect. The initial state is already `loading: true`.
  const load = useCallback((includeArchived: boolean, offset: number, focusId?: string): void => {
    window.electronAPI.ai.memory
      .page({ includeArchived, offset, limit: PAGE_SIZE, ...(focusId ? { focusId } : {}) })
      .then(setPage)
      .catch(() => setPage(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!searchTargetId) {
      load(false, 0)
      return
    }
    // A Ctrl+K hit may be archived: look among all first, and keep the archived
    // filter on only when the target is one, so it is never filtered off screen.
    window.electronAPI.ai.memory
      .page({ includeArchived: true, offset: 0, limit: PAGE_SIZE, focusId: searchTargetId })
      .then((all) => {
        if (all.items.find((m) => m.id === searchTargetId)?.archivedAt) {
          setShowArchived(true)
          setPage(all)
          setLoading(false)
        } else {
          setShowArchived(false)
          load(false, 0, searchTargetId)
        }
      })
      .catch(() => load(false, 0))
  }, [searchTargetId, load])

  useEffect(() => {
    if (!searchTargetId || loading) return
    document.getElementById(`memory-search-${searchTargetId}`)?.scrollIntoView?.({ block: 'center' })
  }, [searchTargetId, loading, page])

  // Main clamps an offset past the end, so a page emptied by a delete steps back.
  const refresh = (): void => load(showArchived, page?.offset ?? 0)
  const toggleArchived = (): void => {
    setShowArchived(!showArchived)
    load(!showArchived, 0)
  }

  const shown = page?.items ?? []
  const archivedCount = page?.archivedCount ?? 0
  const activeCount = page?.activeCount ?? 0
  const pageCount = page ? Math.ceil(page.total / PAGE_SIZE) : 0
  const pageIndex = page ? Math.floor(page.offset / PAGE_SIZE) : 0

  const togglePin = async (m: AiMemory): Promise<void> => {
    await window.electronAPI.ai.memory.save({ id: m.id, pinned: !m.pinned })
    refresh()
  }

  const restore = async (m: AiMemory): Promise<void> => {
    // Saving any field reactivates it (the main process clears archived_at on edit).
    await window.electronAPI.ai.memory.save({ id: m.id, pinned: m.pinned })
    refresh()
  }

  const remove = async (id: string): Promise<void> => {
    await window.electronAPI.ai.memory.delete(id)
    setConfirmId(null)
    refresh()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold text-[#d4d4d4]">Memória do assistente</h1>
          <button
            onClick={toggleArchived}
            className="text-xs px-2.5 py-1 rounded-md text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] transition-colors"
          >
            {showArchived ? 'Ocultar arquivadas' : `Ver arquivadas (${archivedCount})`}
          </button>
        </div>
        <p className="text-xs text-[#999999] mb-5">
          {activeCount} memória{activeCount === 1 ? '' : 's'} ativa{activeCount === 1 ? '' : 's'}. O
          assistente grava fatos duráveis aqui e os relê nas próximas conversas. Memórias sem uso
          são arquivadas com o tempo; fixe uma para que nunca expire.
        </p>

        {loading ? (
          <p className="text-sm text-[#999999]">Carregando…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-[#999999] italic">
            Nenhuma memória ainda. Peça ao assistente para lembrar de algo, ou ela vai gravando
            decisões e armadilhas conforme vocês trabalham.
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((m) => (
              <div
                key={m.id}
                id={m.id === searchTargetId ? `memory-search-${m.id}` : undefined}
                className={`rounded-lg border p-3 ${searchFocusClass(m.id === searchTargetId)} ${
                  m.archivedAt
                    ? 'border-[#2b2b31] bg-transparent opacity-60'
                    : 'border-[#2b2b31] bg-[#101014]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                    style={{
                      color: TYPE_COLOR[m.type],
                      backgroundColor: `${TYPE_COLOR[m.type]}1a`
                    }}
                  >
                    {TYPE_LABEL[m.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {m.pinned && <span title="Fixada" className="text-[11px] text-[#f0b820]">Fixada</span>}
                      <span className="text-sm font-medium text-[#d4d4d4] truncate">{m.title}</span>
                    </div>
                    {m.body && (
                      <p className="text-xs text-[#d4d4d4] mt-1 whitespace-pre-wrap">{m.body}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-[#999999]">
                      <span>{projectName(m.projectId)}</span>
                      {m.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-[#16161a]">
                          {t}
                        </span>
                      ))}
                      {m.archivedAt && <span className="italic">arquivada</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.archivedAt ? (
                      <button
                        onClick={() => void restore(m)}
                        className="text-[11px] px-2 py-1 rounded text-[#999999] hover:text-[#46d478] hover:bg-[#222227] transition-colors"
                      >
                        Restaurar
                      </button>
                    ) : (
                      <button
                        onClick={() => void togglePin(m)}
                        className="text-[11px] px-2 py-1 rounded text-[#999999] hover:text-[#a080f0] hover:bg-[#222227] transition-colors"
                      >
                        {m.pinned ? 'Desafixar' : 'Fixar'}
                      </button>
                    )}
                    {confirmId === m.id ? (
                      <>
                        <button
                          onClick={() => void remove(m.id)}
                          className="text-[11px] px-2 py-1 rounded text-[#ec6a6a] hover:bg-[#222227] transition-colors"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-[11px] px-2 py-1 rounded text-[#999999] hover:bg-[#222227] transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(m.id)}
                        className="text-[11px] px-2 py-1 rounded text-[#999999] hover:text-[#ec6a6a] hover:bg-[#222227] transition-colors"
                      >
                        Apagar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && pageCount > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => load(showArchived, (pageIndex - 1) * PAGE_SIZE)}
              disabled={pageIndex === 0}
              className="text-xs px-2.5 py-1 rounded-md text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Anterior
            </button>
            <span className="text-xs text-[#999999]">
              Página {pageIndex + 1} de {pageCount}
            </span>
            <button
              onClick={() => load(showArchived, (pageIndex + 1) * PAGE_SIZE)}
              disabled={pageIndex + 1 >= pageCount}
              className="text-xs px-2.5 py-1 rounded-md text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Próxima
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
