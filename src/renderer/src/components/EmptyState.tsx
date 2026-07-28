import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-[#d4d4d4] font-medium mb-1">{title}</p>
        {description && <p className="text-sm text-[#999999]">{description}</p>}
      </div>
    </div>
  )
}
