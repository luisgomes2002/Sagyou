import { useCallback, useEffect, useMemo, useState } from 'react'
import { useKanbanStore } from '../store/kanban'
import type { AiMemory, MemoryType } from '../types'

// The memory control panel: see, pin, restore and delete the durable facts the
// assistant accumulated. Reads through window.electronAPI.ai.memory.* (the store
// lives in the main process, outside the Zustand store — like AIView reads chat
// history), so it never touches useKanbanStore except to name a memory's project.

const TYPE_LABEL: Record<MemoryType, string> = {
  decisao: 'Decisão',
  tradeoff: 'Trade-off',
  gotcha: 'Armadilha',
  fato: 'Fato',
  handoff: 'Sessão'
}

const TYPE_COLOR: Record<MemoryType, string> = {
  decisao: '#a5b4fc',
  tradeoff: '#fbbf24',
  gotcha: '#f87171',
  fato: '#94a3b8',
  handoff: '#4ade80'
}

export function MemoryView(): React.JSX.Element {
  const projects = useKanbanStore((s) => s.projects)
  const [memories, setMemories] = useState<AiMemory[]>([])
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
  const refresh = useCallback((): void => {
    window.electronAPI.ai.memory
      .list({ includeArchived: true })
      .then(setMemories)
      .catch(() => setMemories([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const shown = useMemo(
    () => memories.filter((m) => showArchived || !m.archivedAt),
    [memories, showArchived]
  )
  const archivedCount = useMemo(() => memories.filter((m) => m.archivedAt).length, [memories])
  const activeCount = memories.length - archivedCount

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
          <h1 className="text-lg font-semibold text-[#e2e8f0]">Memória do assistente</h1>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs px-2.5 py-1 rounded-md text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            {showArchived ? 'Ocultar arquivadas' : `Ver arquivadas (${archivedCount})`}
          </button>
        </div>
        <p className="text-xs text-[#8892a4] mb-5">
          {activeCount} memória{activeCount === 1 ? '' : 's'} ativa{activeCount === 1 ? '' : 's'}. O
          assistente grava fatos duráveis aqui e os relê nas próximas conversas. Memórias sem uso
          são arquivadas com o tempo; fixe uma para que nunca expire.
        </p>

        {loading ? (
          <p className="text-sm text-[#8892a4]">Carregando…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-[#8892a4] italic">
            Nenhuma memória ainda. Peça ao assistente para lembrar de algo, ou ela vai gravando
            decisões e armadilhas conforme vocês trabalham.
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg border p-3 ${
                  m.archivedAt
                    ? 'border-[#1e2235] bg-transparent opacity-60'
                    : 'border-[#1e2235] bg-[#161a29]'
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
                      {m.pinned && <span title="Fixada">📌</span>}
                      <span className="text-sm font-medium text-[#e2e8f0] truncate">{m.title}</span>
                    </div>
                    {m.body && (
                      <p className="text-xs text-[#b6c0d4] mt-1 whitespace-pre-wrap">{m.body}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[10px] text-[#8892a4]">
                      <span>{projectName(m.projectId)}</span>
                      {m.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-[#1e2235]">
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
                        className="text-[11px] px-2 py-1 rounded text-[#8892a4] hover:text-[#4ade80] hover:bg-[#1e2235] transition-colors"
                      >
                        Restaurar
                      </button>
                    ) : (
                      <button
                        onClick={() => void togglePin(m)}
                        className="text-[11px] px-2 py-1 rounded text-[#8892a4] hover:text-[#a5b4fc] hover:bg-[#1e2235] transition-colors"
                      >
                        {m.pinned ? 'Desafixar' : 'Fixar'}
                      </button>
                    )}
                    {confirmId === m.id ? (
                      <>
                        <button
                          onClick={() => void remove(m.id)}
                          className="text-[11px] px-2 py-1 rounded text-[#f87171] hover:bg-[#f87171]/10 transition-colors"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-[11px] px-2 py-1 rounded text-[#8892a4] hover:bg-[#1e2235] transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(m.id)}
                        className="text-[11px] px-2 py-1 rounded text-[#8892a4] hover:text-[#f87171] hover:bg-[#1e2235] transition-colors"
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
      </div>
    </div>
  )
}
