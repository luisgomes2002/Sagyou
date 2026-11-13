export type FinanceTab = 'lancamentos' | 'resumo' | 'dividas' | 'metas' | 'compras' | 'rendimentos'

export const FINANCE_TABS: { id: FinanceTab; label: string }[] = [
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'resumo', label: 'Resumo' },
  { id: 'dividas', label: 'Dívidas' },
  { id: 'metas', label: 'Metas' },
  { id: 'compras', label: 'Compras' },
  { id: 'rendimentos', label: 'Rendimentos' }
]
