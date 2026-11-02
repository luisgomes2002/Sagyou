import { useEffect, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'

export interface SectionedPageItem<T extends string> {
  id: T
  label: string
  icon?: JSX.Element
  group?: string
}

interface SectionedPageProps<T extends string> {
  title: string
  items: SectionedPageItem<T>[]
  activeId: T
  onSelect: (id: T) => void
  navTop?: JSX.Element
  emptyNav?: JSX.Element
  heading: string
  description?: string
  /**
   * The heading takes focus whenever this changes (default: `activeId`). The
   * guide passes a counter of explicit picks, so typing in its search box —
   * which can change the open article — never steals focus from the field.
   */
  focusKey?: unknown
  children: ReactNode
}

/**
 * Shared skeleton of Configurações and Como funciona: a section list on the
 * left (a horizontal strip on narrow windows) and one section at a time.
 */
export function SectionedPage<T extends string>({
  title,
  items,
  activeId,
  onSelect,
  navTop,
  emptyNav,
  heading,
  description,
  focusKey,
  children
}: SectionedPageProps<T>): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusTrigger = focusKey === undefined ? activeId : focusKey
  // Compare with the last value rather than a "first render" flag: StrictMode
  // runs effects twice on mount, which a flag would read as a change.
  const lastFocusTrigger = useRef(focusTrigger)

  useEffect(() => {
    if (Object.is(lastFocusTrigger.current, focusTrigger)) return
    lastFocusTrigger.current = focusTrigger
    headingRef.current?.focus()
  }, [focusTrigger])

  const onNavKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-section-item]')
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next =
      current === -1
        ? step === 1
          ? 0
          : buttons.length - 1
        : (current + step + buttons.length) % buttons.length
    buttons[next].focus()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0b0b0f] md:flex-row">
      <aside className="shrink-0 border-b border-[#2b2b31] bg-[#121216] md:flex md:w-60 md:flex-col md:border-b-0 md:border-r">
        <p className="hidden px-5 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-[#999999] md:block">
          {title}
        </p>
        {navTop && <div className="px-3 pb-2 pt-3 md:pt-0">{navTop}</div>}
        <nav
          aria-label={title}
          onKeyDown={onNavKeyDown}
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-visible"
        >
          {items.length === 0 && emptyNav}
          {items.map((item, index) => {
            const showGroup =
              item.group !== undefined && (index === 0 || items[index - 1].group !== item.group)
            const active = item.id === activeId
            return (
              <div key={item.id} className="shrink-0 md:shrink">
                {showGroup && (
                  <p className="hidden px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#999999] md:block">
                    {item.group}
                  </p>
                )}
                <button
                  type="button"
                  data-section-item=""
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors md:whitespace-normal ${
                    active
                      ? 'bg-[#2a2a30] font-medium text-[#d4d4d4]'
                      : 'text-[#999999] hover:bg-[#222227] hover:text-[#d4d4d4]'
                  }`}
                >
                  {item.icon && (
                    <span
                      className={active ? 'text-[#a080f0]' : 'text-[#999999]'}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                </button>
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <header className="mb-6">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold text-[#d4d4d4] outline-none"
            >
              {heading}
            </h2>
            {description && <p className="mt-1 text-sm text-[#999999]">{description}</p>}
          </header>
          {children}
        </div>
      </div>
    </div>
  )
}
