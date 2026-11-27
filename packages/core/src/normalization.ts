import type {
  ActiveTimer,
  Currency,
  FinancialProfile,
  FinancialTable,
  FinancialTransactionDetail,
  Project,
  StickyNote
} from './types'
import { DEFAULT_FINANCIAL_PROFILE_ID } from './types'
import { preserveLegacyFinancialMetadata } from './financialLegacy'
import { D, moneyStr } from './money'
import { migrateYieldSummaryDates } from './yieldSummary'

/**
 * The selected code paths. Only the list is written; a project from an old backup that has
 * just the retired singular `activeCodePathId` still reads as a one-item list.
 */
export function activeCodePathIds(project: Project): string[] {
  if (Array.isArray(project.activeCodePathIds)) return project.activeCodePathIds
  return project.activeCodePathId ? [project.activeCodePathId] : []
}

export function withActiveCodePaths(ids: string[]): Pick<Project, 'activeCodePathIds'> {
  return { activeCodePathIds: ids }
}

export function normalizeProject(project: Project, index: number): Project {
  const known = new Set((project.codePaths ?? []).map((path) => path.id))
  const ids = activeCodePathIds(project).filter((id) => known.has(id))
  // The retired singular field is read above and never kept.
  const { activeCodePathId: _retired, ...rest } = project
  void _retired
  return { ...rest, order: project.order ?? index, ...withActiveCodePaths(ids) }
}

export function normalizeNotes(notes: StickyNote[]): StickyNote[] {
  return notes.map((note) => ({
    ...note,
    taskIds: note.taskIds ?? (note.taskId ? [note.taskId] : []),
    connections: note.connections ?? [],
    goalIds: note.goalIds ?? []
  }))
}

// Load and backup import must apply the exact same money and detail migrations.
// A display-only conversion here can otherwise overwrite historical amounts.
export function normalizeFinancialTable(list: FinancialTable): FinancialTable {
  const table = migrateYieldSummaryDates(preserveLegacyFinancialMetadata(list))
  return {
    ...table,
    profileId: list.profileId || DEFAULT_FINANCIAL_PROFILE_ID,
    currency: (list.currency || 'BRL') as Currency,
    items: (list.items ?? []).map((item) => ({
      ...item,
      price: item.price === null || item.price === undefined ? undefined : moneyStr(item.price)
    })),
    transactions: (table.transactions ?? []).map((transaction) => {
      const amount = moneyStr(transaction.amount)
      return {
        ...transaction,
        amount,
        details: normalizeTransactionDetails(transaction.details, amount)
      }
    }),
    actualBalance: list.actualBalance == null ? undefined : moneyStr(list.actualBalance),
    goals: (list.goals ?? []).map((goal) => ({
      ...goal,
      targetAmount: moneyStr(goal.targetAmount)
    })),
    debts: (list.debts ?? []).flatMap((debt) => {
      if (!debt || !debt.id || !debt.name) return []
      const originalAmount = D(debt.originalAmount)
      const remainingAmount = D(debt.remainingAmount)
      if (
        originalAmount.lessThanOrEqualTo(0) ||
        remainingAmount.lessThan(0) ||
        remainingAmount.greaterThan(originalAmount)
      )
        return []
      return [
        {
          ...debt,
          originalAmount: originalAmount.toString(),
          remainingAmount: remainingAmount.toString()
        }
      ]
    }),
    yieldSources: (list.yieldSources ?? []).map((source) => ({ ...source })),
    yieldEntries: (list.yieldEntries ?? []).map((entry) => ({
      ...entry,
      amount: moneyStr(entry.amount)
    }))
  }
}

function normalizeTransactionDetails(value: unknown, total: string): FinancialTransactionDetail[] {
  if (!Array.isArray(value)) return []
  let remaining = D(total)
  const details: FinancialTransactionDetail[] = []
  for (const detail of value) {
    if (!detail || typeof detail !== 'object' || remaining.lessThanOrEqualTo(0)) continue
    const item = detail as Partial<FinancialTransactionDetail>
    if (typeof item.id !== 'string' || typeof item.description !== 'string') continue
    const requested = D(item.amount)
    if (requested.lessThanOrEqualTo(0)) continue
    const amount = requested.lessThan(remaining) ? requested : remaining
    details.push({
      id: item.id,
      description: item.description,
      amount: amount.toString(),
      ...(typeof item.category === 'string' && item.category.trim()
        ? { category: item.category.trim() }
        : {}),
      ...(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? { date: item.date }
        : {}),
      ...(typeof item.linkedTransactionId === 'string' && item.linkedTransactionId
        ? { linkedTransactionId: item.linkedTransactionId }
        : {})
    })
    remaining = remaining.minus(amount)
  }
  return details
}

const DEFAULT_FINANCIAL_PROFILE: FinancialProfile = {
  id: DEFAULT_FINANCIAL_PROFILE_ID,
  name: 'Minhas finanças',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z'
}

export function normalizeFinancialProfiles(value: unknown): FinancialProfile[] {
  if (!Array.isArray(value)) return [{ ...DEFAULT_FINANCIAL_PROFILE }]
  const profiles = value.filter(
    (profile): profile is FinancialProfile =>
      !!profile &&
      typeof profile === 'object' &&
      typeof (profile as FinancialProfile).id === 'string' &&
      typeof (profile as FinancialProfile).name === 'string' &&
      typeof (profile as FinancialProfile).createdAt === 'string' &&
      typeof (profile as FinancialProfile).updatedAt === 'string'
  )
  const suggestions = (items: unknown): string[] | undefined => {
    if (!Array.isArray(items)) return undefined
    return [
      ...new Map(
        items
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map((item) => [item.trim().toLocaleLowerCase('pt-BR'), item.trim()])
      ).values()
    ]
  }
  return profiles.length
    ? profiles.map((profile) => ({
        ...profile,
        ...(suggestions(profile.customCategories)
          ? { customCategories: suggestions(profile.customCategories) }
          : {}),
        ...(suggestions(profile.savedSources)
          ? { savedSources: suggestions(profile.savedSources) }
          : {}),
        ...(suggestions(profile.savedCounterparties)
          ? { savedCounterparties: suggestions(profile.savedCounterparties) }
          : {})
      }))
    : [{ ...DEFAULT_FINANCIAL_PROFILE }]
}

export function normalizeTimers(data: { activeTimers?: unknown }): ActiveTimer[] {
  const valid = (timer: unknown): timer is ActiveTimer =>
    !!timer &&
    typeof (timer as ActiveTimer).taskId === 'string' &&
    typeof (timer as ActiveTimer).startedAt === 'number'
  return Array.isArray(data.activeTimers) ? data.activeTimers.filter(valid) : []
}
