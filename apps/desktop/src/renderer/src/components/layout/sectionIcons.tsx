import type { JSX, ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SECTION_ICONS = {
  user: (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  ),
  palette: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="10" r="1.2" />
      <circle cx="12" cy="7.5" r="1.2" />
      <circle cx="16" cy="10" r="1.2" />
      <path d="M12 21a2.5 2.5 0 0 1 0-5h2a3 3 0 0 0 3-3" />
    </Icon>
  ),
  sidebar: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  ),
  sync: (
    <Icon>
      <path d="M20 12a8 8 0 0 1-14.3 4.9" />
      <path d="M4 12A8 8 0 0 1 18.3 7.1" />
      <path d="M18 3v4.5h-4.5" />
      <path d="M6 21v-4.5h4.5" />
    </Icon>
  ),
  system: (
    <Icon>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </Icon>
  ),
  key: (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2" />
    </Icon>
  ),
  info: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </Icon>
  )
} satisfies Record<string, JSX.Element>
