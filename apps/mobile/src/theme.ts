import { useColorScheme } from 'react-native'

// Colors from UI_DESIGN.md (dark) and the desktop's light theme in index.css.
// Solid surfaces, no glow; color goes on the value, the icon or a small marker.
export interface Theme {
  dark: boolean
  bg: string
  surface: string
  field: string
  selected: string
  border: string
  text: string
  muted: string
  green: string
  red: string
  purple: string
  attention: string
  primary: string
  onPrimary: string
  /** Icons that carry no meaning of their own (same tone as labels). */
  onSurfaceIcon: string
}

export const darkTheme: Theme = {
  dark: true,
  bg: '#0b0b0f',
  surface: '#16161a',
  field: '#101014',
  selected: '#2a2a30',
  border: '#2b2b31',
  text: '#d4d4d4',
  muted: '#999999',
  green: '#46d478',
  red: '#ec6a6a',
  purple: '#a080f0',
  attention: '#d9a640',
  primary: '#6d5bb8',
  onPrimary: '#ffffff',
  onSurfaceIcon: '#999999'
}

// Light semantic colors are darker so they keep contrast on white (decisão do construtor).
export const lightTheme: Theme = {
  dark: false,
  bg: '#f5f4f1',
  surface: '#ffffff',
  field: '#ebe9e4',
  selected: '#e5e2dc',
  border: '#d2cec6',
  text: '#292724',
  muted: '#625f59',
  green: '#1f7a45',
  red: '#b83232',
  purple: '#5b4aa6',
  attention: '#8a6414',
  primary: '#6d5bb8',
  onPrimary: '#ffffff',
  onSurfaceIcon: '#625f59'
}

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme
}

/** Corner radii: cards and sheets, fields and buttons, chips and the (+). */
export const RADIUS = { card: 12, control: 10, pill: 999 } as const
/** Spacing scale, multiples of 4. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
/** Type scale; the system font, scaled by the user's font size. */
export const FONT = { caption: 12, body: 14, bodyLg: 16, title: 20, display: 28 } as const
/** Smallest touch target (dp). */
export const MIN_TOUCH = 48

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

/** WCAG contrast ratio between two `#rrggbb` colors (1 to 21). */
export function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
