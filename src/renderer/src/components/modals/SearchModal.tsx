import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useKanbanStore } from '../../store/kanban'
import type {
  GlobalSearchHit,
  GlobalSearchResponse,
  GlobalSearchType
} from '../../../../main/global-search-query'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (hit: GlobalSearchHit) => void
}

const PAGE_SIZE = 30
const AREAS: { label: string; types: { type: GlobalSearchType; label: string }[] }[] = [
  {
    label: 'Projetos e tarefas',
    types: [
      { type: 'project', label: 'Projeto' },
      { type: 'task', label: 'Tarefa' }
    ]
  },
  { label: 'Notas', types: [{ type: 'note', label: 'Nota' }] },
  {
    label: 'Metas e hábitos',
    types: [
      { type: 'goal', label: 'Meta' },
      { type: 'habit', label: 'Hábito' }
    ]
  },
  {
    label: 'Planejamento',
    types: [
      { type: 'time_block', label: 'Bloco de tempo' },
      { type: 'routine', label: 'Rotina' }
    ]
  },
  { label: 'Arquivos', types: [{ type: 'file', label: 'Arquivo' }] },
  {
    label: 'Finanças',
    types: [
      { type: 'financial_profile', label: 'Perfil financeiro' },
      { type: 'financial_table', label: 'Tabela financeira' },
      { type: 'shopping_item', label: 'Item de compra' },
      { type: 'transaction', label: 'Transação' },
      { type: 'transaction_detail', label: 'Detalhe de transação' },
      { type: 'financial_goal', label: 'Meta financeira' },
      { type: 'yield_source', label: 'Fonte de rendimento' }
    ]
  },
  {
    label: 'IA',
    types: [
      { type: 'conversation', label: 'Conversa' },
      { type: 'memory', label: 'Memória' }
    ]
  }
]
const TYPE_LABELS = new Map(
  AREAS.flatMap((area) => area.types.map((item) => [item.type, item.label] as const))
)
const FINANCIAL_TYPES = new Set<GlobalSearchType>(
  AREAS.find((area) => area.label === 'Finanças')?.types.map((item) => item.type) ?? []
)

export function SearchModal({ open, onClose, onSelect }: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<GlobalSearchType | ''>('')
  const [projectId, setProjectId] = useState('')
  const [page, setPage] = useState(0)
  const [response, setResponse] = useState<GlobalSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([])
  const requestId = useRef(0)
  const projects = useKanbanStore((s) => s.projects)
  const activeFinancialProfileId = useKanbanStore((s) => s.activeFinancialProfileId)
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  useEffect(() => {
    if (!open) {
      requestId.current += 1
      previousFocus.current?.focus()
      previousFocus.current = null
      return
    }
    previousFocus.current = document.activeElement as HTMLElement | null
    const timer = setTimeout(() => {
      setQuery('')
      setType('')
      setProjectId('')
      setPage(0)
      setResponse(null)
      setError(false)
      setSelected(0)
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || !query.trim()) return
    const currentRequest = ++requestId.current
    const timer = setTimeout(
      () => {
        setLoading(true)
        setError(false)
        window.electronAPI.search
          .global({
            term: query,
            types: type ? [type] : undefined,
            projectId: projectId || undefined,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE
          })
          .then((next) => {
            if (currentRequest !== requestId.current) return
            setResponse((previous) =>
              page === 0
                ? next
                : { ...next, results: [...(previous?.results ?? []), ...next.results] }
            )
          })
          .catch(() => {
            if (currentRequest === requestId.current) setError(true)
          })
          .finally(() => {
            if (currentRequest === requestId.current) setLoading(false)
          })
      },
      page === 0 ? 180 : 0
    )
    return () => {
      clearTimeout(timer)
      requestId.current += 1
    }
  }, [open, query, type, projectId, page, activeFinancialProfileId])

  // A profile switch can happen while an IPC response is in flight or still visible.
  const results = (response?.results ?? []).filter(
    (hit) => !FINANCIAL_TYPES.has(hit.type) || hit.profileId === activeFinancialProfileId
  )
  const grouped = AREAS.map((area) => ({
    label: area.label,
    hits: results.filter((hit) => area.types.some((item) => item.type === hit.type))
  })).filter((area) => area.hits.length > 0)
  const ordered = grouped.flatMap((area) => area.hits)

  useEffect(() => {
    if (open && ordered.length) resultRefs.current[selected]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, selected, ordered.length])

  const resetSearch = (): void => {
    requestId.current += 1
    setPage(0)
    setResponse(null)
    setLoading(false)
    setError(false)
    setSelected(0)
  }

  const choose = (hit: GlobalSearchHit): void => {
    onSelect(hit)
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && ordered.length) {
      event.preventDefault()
      setSelected((index) => (index + 1) % ordered.length)
    } else if (event.key === 'ArrowUp' && ordered.length) {
      event.preventDefault()
      setSelected((index) => (index - 1 + ordered.length) % ordered.length)
    } else if (event.key === 'Enter' && ordered[selected]) {
      event.preventDefault()
      choose(ordered[selected])
    }
  }

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input, select, button')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  if (!open) return null
  let resultIndex = 0
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onKeyDownCapture={onDialogKeyDown}
        className="relative z-10 w-full max-w-2xl mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#3b3b3b]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#999999"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Buscar em todo o aplicativo"
            aria-autocomplete="list"
            aria-expanded={ordered.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              ordered[selected] ? `global-search-result-${selected}` : undefined
            }
            value={query}
            onChange={(event) => {
              resetSearch()
              setQuery(event.target.value)
            }}
            onKeyDown={onKeyDown}
            placeholder="Buscar em todo o aplicativo..."
            className="flex-1 min-w-0 bg-transparent text-sm text-[#d4d4d4] placeholder-[#999999] outline-none"
          />
          <kbd className="text-[10px] text-[#999999] px-1.5 py-0.5 rounded bg-[#1b1b1b] border border-[#3b3b3b] shrink-0">
            Esc
          </kbd>
        </div>
        <div className="flex gap-2 px-4 py-2 border-b border-[#3b3b3b]">
          <label className="sr-only" htmlFor="global-search-type">
            Tipo
          </label>
          <select
            id="global-search-type"
            value={type}
            onChange={(event) => {
              resetSearch()
              setType(event.target.value as GlobalSearchType | '')
              inputRef.current?.focus()
            }}
            className="min-w-0 max-w-[50%] rounded-md border border-[#3b3b3b] bg-[#2a2a2a] px-2 py-1 text-xs text-[#d4d4d4]"
          >
            <option value="">Todos os tipos</option>
            {AREAS.map((area) => (
              <optgroup key={area.label} label={area.label}>
                {area.types.map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label className="sr-only" htmlFor="global-search-project">
            Projeto
          </label>
          <select
            id="global-search-project"
            value={projectId}
            onChange={(event) => {
              resetSearch()
              setProjectId(event.target.value)
              inputRef.current?.focus()
            }}
            className="min-w-0 max-w-[50%] rounded-md border border-[#3b3b3b] bg-[#2a2a2a] px-2 py-1 text-xs text-[#d4d4d4]"
          >
            <option value="">Todos os projetos</option>
            {projects
              .filter((project) => !project.archivedAt)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </div>
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Resultados da busca"
          aria-busy={loading}
          className="max-h-[min(60vh,500px)] overflow-y-auto"
        >
          {!query.trim() && (
            <p className="px-4 py-8 text-center text-sm text-[#999999]">
              Digite para buscar em projetos, tarefas, notas, metas, hábitos, planejamento,
              arquivos, finanças e IA.
            </p>
          )}
          {query.trim() && loading && !response && (
            <p role="status" className="px-4 py-8 text-center text-sm text-[#999999]">
              Buscando...
            </p>
          )}
          {query.trim() && error && (
            <p role="alert" className="px-4 py-8 text-center text-sm text-[#ec6a6a]">
              Não foi possível buscar. Tente novamente.
            </p>
          )}
          {query.trim() && !loading && !error && response?.total === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[#999999]">
              Nenhum resultado para “{query}”.
            </p>
          )}
          {grouped.map((area) => (
            <div key={area.label} role="group" aria-label={area.label}>
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                {area.label}
              </p>
              {area.hits.map((hit) => {
                const index = resultIndex++
                return (
                  <button
                    key={`${hit.type}:${hit.id}`}
                    type="button"
                    id={`global-search-result-${index}`}
                    ref={(node) => {
                      resultRefs.current[index] = node
                    }}
                    role="option"
                    aria-selected={selected === index}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => choose(hit)}
                    className={`block w-full cursor-pointer px-4 py-2.5 text-left border-l-2 ${selected === index ? 'bg-[#3b3b3b] border-[#a080f0]' : 'border-transparent hover:bg-[#2a2a2a]'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-[#d4d4d4]">
                        {hit.title || '(sem título)'}
                      </span>
                      <span className="shrink-0 text-[10px] text-[#999999]">
                        {TYPE_LABELS.get(hit.type)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[#999999]">{hit.snippet}</p>
                    {hit.projectId && (
                      <p className="mt-0.5 truncate text-[10px] text-[#999999]">
                        {projectNames.get(hit.projectId) ?? 'Projeto'}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
          {response && response.total > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-[#3b3b3b] px-4 py-2 text-xs text-[#999999]">
              <span role="status">
                {results.length} de {response.total} resultados
              </span>
              {response.hasMore && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setPage((value) => value + 1)
                    inputRef.current?.focus()
                  }}
                  className="rounded-md border border-[#3b3b3b] bg-[#2a2a2a] px-2 py-1 text-[#d4d4d4] hover:bg-[#4a4a4a] disabled:opacity-50"
                >
                  {loading ? 'Carregando...' : `Mostrar mais (${response.total - results.length})`}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="border-t border-[#3b3b3b] px-4 py-2 text-[10px] text-[#999999]">
          ↑ ↓ selecionar · Enter abrir · Esc fechar
        </p>
      </div>
    </div>,
    document.body
  )
}
