import type { ReactNode } from 'react'

interface ModeToggleButtonProps {
  active: boolean
  label: string
  activeLabel: string
  title: string
  onClick: () => void
  icon?: ReactNode
}

export function ModeToggleButton({
  active,
  label,
  activeLabel,
  title,
  onClick,
  icon
}: ModeToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? 'bg-[#2a2a2a] text-[#d4d4d4]'
          : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
      }`}
    >
      {icon}
      {active ? activeLabel : label}
    </button>
  )
}
