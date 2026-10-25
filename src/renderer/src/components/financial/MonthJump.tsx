import { useRef, type ReactElement } from 'react'

interface MonthJumpProps {
  month: { year: number; month: number }
  onChange: (month: { year: number; month: number }) => void
}

export function MonthJump({ month, onChange }: MonthJumpProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const value = `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`

  const goToMonth = (): void => {
    const input = inputRef.current
    if (!input) return
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input.value)
    if (!match || Number(match[1]) === 0) {
      input.focus()
      return
    }
    onChange({ year: Number(match[1]), month: Number(match[2]) })
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        key={value}
        ref={inputRef}
        type="month"
        defaultValue={value}
        aria-label="Escolher mês e ano"
        title="Escolha o mês e o ano ou digite os valores"
        className="w-36 rounded-md border border-[#2b2b31] bg-[#16161a] px-2 py-1 text-xs text-[#d4d4d4] focus:border-[#7c3aed] focus:outline-none"
        style={{ colorScheme: 'dark' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') goToMonth()
        }}
      />
      <button
        type="button"
        onClick={goToMonth}
        className="rounded-md border border-[#2b2b31] bg-[#16161a] px-2 py-1 text-xs font-medium text-[#d4d4d4] hover:border-[#7c3aed] hover:text-white transition-colors"
      >
        Ir
      </button>
    </div>
  )
}
