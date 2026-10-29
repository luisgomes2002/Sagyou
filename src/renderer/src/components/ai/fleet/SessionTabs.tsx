import { STATUS_STYLE, type SessionStatus } from './format'

export interface SessionItem {
  /** Stable selection key: `run:<id>`. */
  key: string
  kind: 'run'
  title: string
  /** Project · harness, already resolved. */
  subtitle: string
  status: SessionStatus
  meta?: string
}

function SessionTab({
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
      aria-label={`${item.title} — ${style.label} — ${item.subtitle} — ${item.key.slice(4)}`}
      title={`${item.title} — ${item.subtitle}`}
      className={`flex w-44 shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#a080f0] ${
        selected
          ? 'border-[#3a3a42] bg-[#2a2a30]'
          : 'border-[#2b2b31] bg-[#16161a] hover:bg-[#222227]'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[#d4d4d4]">{item.title}</span>
        <span className="block truncate text-[10px] text-[#8a8a92]">{item.subtitle}</span>
      </span>
      {item.meta && <span className="shrink-0 text-[10px] text-[#8a8a92]">{item.meta}</span>}
    </button>
  )
}

/** The session list scrolls independently so terminal width and the new button stay available. */
export function SessionTabs({
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
    <nav
      aria-label="Sessões"
      className="flex min-w-0 shrink-0 items-center gap-3 border-b border-[#2b2b31] bg-[#121216] px-3 py-2"
    >
      <div className="shrink-0">
        <h1 className="text-xs font-semibold text-[#ededed]">Código</h1>
        <p className="text-[10px] text-[#8a8a92]">Ativas · {items.length}</p>
      </div>
      <div
        role="group"
        aria-label="Sessões ativas"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
      >
        {items.length === 0 ? (
          <p className="shrink-0 py-2 text-xs text-[#8a8a92]">Nenhuma sessão em andamento.</p>
        ) : (
          items.map((item) => (
            <SessionTab
              key={item.key}
              item={item}
              selected={item.key === selectedKey}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onNew}
        disabled={starting}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#2b2b31] bg-[#2a2a30] px-2.5 py-2 text-xs font-medium text-[#d4d4d4] hover:bg-[#303036] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a080f0] disabled:cursor-wait disabled:opacity-70"
      >
        <span className="text-sm leading-none text-[#a080f0]" aria-hidden="true">
          +
        </span>
        {starting ? 'Abrindo terminal…' : 'Nova sessão'}
      </button>
    </nav>
  )
}
