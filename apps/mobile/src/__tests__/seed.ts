// Shared fixtures for screen tests (not a test file: no .test suffix).
import { emptyState, type MobileState } from '../data/state'
import { type AppServices, useApp } from '../store/app'

export const T = '2026-10-01T00:00:00.000Z'

type Project = MobileState['projects'][number]
type Column = Project['columns'][number]
type Table = MobileState['lists'][number]

export function project(
  id: string,
  name: string,
  columns: Column[] = [
    { id: `${id}-todo`, name: 'A fazer', order: 0 },
    { id: `${id}-done`, name: 'Done', order: 1 }
  ],
  extra: Partial<Project> = {}
): Project {
  return {
    id,
    name,
    color: '#6366f1',
    order: 0,
    createdAt: T,
    updatedAt: T,
    columns,
    ...extra
  } as unknown as Project
}

export function table(
  id: string,
  name: string,
  profileId = 'personal',
  transactions: Table['transactions'] = [],
  currency: Table['currency'] = 'BRL'
): Table {
  return {
    id,
    name,
    currency,
    profileId,
    items: [],
    goals: [],
    transactions,
    createdAt: T,
    updatedAt: T
  }
}

export interface Seeded {
  save: jest.Mock
  writePref: jest.Mock
  prefs: Record<string, string>
}

/** Puts a state in the store with in-memory prefs and spies on saves. */
export function seedApp(
  partial: Partial<MobileState> = {},
  options: { readOnly?: boolean; prefs?: Record<string, string>; profileId?: string } = {}
): Seeded {
  const prefs = { ...(options.prefs ?? {}) }
  const save = jest.fn()
  const writePref = jest.fn((key: string, value: string | null) => {
    if (value === null) delete prefs[key]
    else prefs[key] = value
  })
  useApp.setState({
    mode: 'app',
    state: { ...emptyState(), ...partial },
    readOnly: options.readOnly ?? false,
    profileId: options.profileId ?? 'personal',
    status: null,
    services: {
      repo: { save, readPref: (key: string) => prefs[key] ?? null, writePref },
      runtime: { engine: { notifySaved: jest.fn() } },
      search: () => []
    } as unknown as AppServices
  })
  return { save, writePref, prefs }
}
