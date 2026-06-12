import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'

const dataPath = join(app.getPath('userData'), is.dev ? 'kanban-data.dev.json' : 'kanban-data.json')

export function loadData(): { projects: unknown[]; tasks: unknown[] } {
  if (!existsSync(dataPath)) return { projects: [], tasks: [] }
  try {
    return JSON.parse(readFileSync(dataPath, 'utf-8'))
  } catch {
    return { projects: [], tasks: [] }
  }
}

export function saveData(data: unknown): void {
  writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8')
}
