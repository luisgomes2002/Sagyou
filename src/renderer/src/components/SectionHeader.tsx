import type { ReactNode } from 'react'

interface Props {
  className?: string
  children: ReactNode
}

/**
 * Consistent header bar: border-bottom, padding, and shrink-0.
 * Caller controls the inner flex layout via className.
 */
export function SectionHeader({ className, children }: Props) {
  return (
    <div className={`px-6 py-4 border-b border-[#2b2b31] shrink-0 ${className ?? ''}`}>
      {children}
    </div>
  )
}
