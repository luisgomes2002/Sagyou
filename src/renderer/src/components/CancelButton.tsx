import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function CancelButton({ children, className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm rounded-lg border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}
