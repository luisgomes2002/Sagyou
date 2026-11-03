import type { FeatureId } from './types'

/** Every top-level screen `App.tsx` can show. */
export type AppView =
  | 'home'
  | 'board'
  | 'canvas'
  | 'done'
  | 'goals'
  | 'habits'
  | 'financial'
  | 'upcoming'
  | 'reports'
  | 'files'
  | 'ai'
  | 'memory'
  | 'planejamento'
  | 'graph'
  | 'guide'
  | 'settings'

/** The sidebar feature that must be on for a view to be reachable. */
export const VIEW_FEATURE: Partial<Record<AppView, FeatureId>> = {
  board: 'kanban',
  upcoming: 'kanban',
  done: 'kanban',
  goals: 'goals',
  habits: 'habits',
  financial: 'financial',
  planejamento: 'planning',
  reports: 'reports',
  canvas: 'canvas',
  files: 'files',
  graph: 'graph',
  ai: 'ai',
  memory: 'ai'
}

export function isViewEnabled(view: AppView, enabled: FeatureId[]): boolean {
  const feature = VIEW_FEATURE[view]
  return !feature || enabled.includes(feature)
}

export type SettingsSectionId =
  | 'geral'
  | 'aparencia'
  | 'barra-lateral'
  | 'seguranca'
  | 'sincronizacao'
  | 'mcp-externo'
  | 'controle-remoto'
  | 'sistema'
  | 'sobre'

/** Where an in-app link (guide article, settings shortcut) wants to go. */
export type NavTarget =
  | { view: Exclude<AppView, 'settings' | 'guide'> }
  | { view: 'settings'; section: SettingsSectionId }
  | { view: 'guide'; articleId?: string }
