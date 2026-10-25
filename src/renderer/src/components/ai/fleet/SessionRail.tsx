import { STATUS_STYLE, type SessionStatus } from './format'

export interface SessionItem {
  /** Stable selection key: `run:<id>`. */
  key: string
  kind: 'run'
  title: string
  /** Project · harness, already resolved. */
  subtitle: string
  status: SessionStatus
  /** Right-aligned hint: the step badge. */
  meta?: string
}

function Row({
  item,
  selected,
  onSelect
}: {
  item: SessionItem
  selected: boolean
  onSelect: (key: string) => void
}): React.JSX.Element {
  const style = STATUS_STYLE[item.status]
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${item.title} — ${style.label}`}
      className={`group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-[#7c3aed]/60 bg-[#211c33]'
          : 'border-transparent hover:border-[#2b2b31] hover:bg-[#1b1b20]'
      }`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[#d4d4d4]">{item.title}</span>
        <span className="block truncate text-[11px] text-[#8a8a92]">{item.subtitle}</span>
      </span>
      {item.meta && (
        <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-[#8a8a92]">{item.meta}</span>
      )}
    </button>
  )
}

/**
 * Left rail of the code-sessions workspace: every session in one scannable
 * list, live ones first. Selecting a row fills the workspace; nothing here
 * expands inline, so the list stays short regardless of how much a run logged.
 */
export function SessionRail({
  items,
  selectedKey,
  onSelect,
  onNew,
  starting
}: {
  items: SessionItem[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onNew: () => void
  starting: boolean
}): React.JSX.Element {
  return (
    <aside
      aria-label="Sessões"
      className="flex w-72 shrink-0 flex-col border-r border-[#2b2b31] bg-[#131317]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#2b2b31] px-4 py-3">
        <h1 className="text-sm font-semibold text-[#ededed]">Código</h1>
        <button
          type="button"
          onClick={onNew}
          disabled={starting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:cursor-wait disabled:opacity-70"
        >
          {starting ? 'Abrindo terminal…' : 'Nova sessão'}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
        <section aria-label="Sessões ativas">
          <h2 className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-[#8a8a92]">
            Ativas · {items.length}
          </h2>
          {items.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[#6f6f77]">Nenhuma sessão em andamento.</p>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => (
                <Row key={item.key} item={item} selected={item.key === selectedKey} onSelect={onSelect} />
              ))}
            </div>
          )}
        </section>

      </div>
    </aside>
  )
}
