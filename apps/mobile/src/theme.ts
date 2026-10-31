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
  onPrimary: '#ffffff'
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
  onPrimary: '#ffffff'
}

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme
}
