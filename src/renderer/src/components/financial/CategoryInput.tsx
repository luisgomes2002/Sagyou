import { useState } from 'react'
import { FINANCIAL_CATEGORIES } from './shared'

interface CategoryInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  className?: string
}

export function CategoryInput({
  value,
  onChange,
  onCommit,
  onKeyDown,
  placeholder,
  className
}: CategoryInputProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const filtered = value.trim()
    ? FINANCIAL_CATEGORIES.filter((category) =>
        category.toLowerCase().includes(value.toLowerCase())
      )
    : FINANCIAL_CATEGORIES

  const select = (category: string): void => {
    onChange(category)
    setOpen(false)
    onCommit?.(category)
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          onCommit?.(value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          onKeyDown?.(event)
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-44 max-h-52 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-xl py-1">
          {filtered.map((category) => (
            <button
              key={category}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(category)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[#2a2a2a] ${
                value === category
                  ? 'bg-[#2a2a2a] text-[#999999]'
                  : 'text-[#999999] hover:text-[#d4d4d4]'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
