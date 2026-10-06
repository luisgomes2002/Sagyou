import type { FinancialTransaction, FinancialTransactionAudit } from '../types'

export function applyFinancialTransactionEdit(
  transaction: FinancialTransaction,
  updates: Partial<Omit<FinancialTransaction, 'id'>>,
  at: string
): FinancialTransaction {
  const changes: FinancialTransactionAudit['changes'] = Object.entries(updates)
    .filter(
      ([field, after]) =>
        field !== 'audit' &&
        field !== 'createdAt' &&
        field !== 'updatedAt' &&
        JSON.stringify(transaction[field as keyof FinancialTransaction]) !== JSON.stringify(after)
    )
    .map(([field, after]) => ({
      field,
      before: transaction[field as keyof FinancialTransaction],
      after
    }))
  if (changes.length === 0) return transaction
  const resetReconciliation =
    transaction.reconciledAt &&
    !Object.hasOwn(updates, 'reconciledAt') &&
    changes.some((change) =>
      ['amount', 'date', 'type', 'source', 'bankReference', 'counterparty'].includes(change.field)
    )
  if (resetReconciliation) {
    changes.push({ field: 'reconciledAt', before: transaction.reconciledAt, after: undefined })
  }
  return {
    ...transaction,
    ...updates,
    ...(resetReconciliation ? { reconciledAt: undefined } : {}),
    updatedAt: at,
    audit: [...(transaction.audit ?? []), { at, changes }]
  }
}
