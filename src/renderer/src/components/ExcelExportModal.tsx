import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { Project, Task, Habit, Goal, FinancialTable, Sprint, StickyNote } from '../types'
import { buildWorkbook, type ExportKey } from '../utils/excelExport'

interface Props {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  habits: Habit[]
  goals: Goal[]
  notes: StickyNote[]
  lists: FinancialTable[]
  onClose: () => void
  onToast?: (msg: string) => void
}

type DataKey = ExportKey

const OPTIONS: { key: DataKey; label: string; description: string }[] = [
  { key: 'projects',       label: 'Projetos',           description: 'Nome, descrição, cor, nº de colunas e links' },
  { key: 'tasks',          label: 'Tarefas',             description: 'Título, projeto, coluna, sprint, prioridade, tags, prazo, tempo gasto' },
  { key: 'sprints',        label: 'Sprints',             description: 'Nome, projeto, status, data de abertura e fechamento' },
  { key: 'habits',         label: 'Hábitos',             description: 'Nome, total de conclusões, última conclusão' },
  { key: 'goals',          label: 'Metas',               description: 'Título, meta, unidade, progresso atual, projeto' },
  { key: 'notes',          label: 'Notas (canvas)',      description: 'Projeto, tipo, conteúdo, data de criação' },
  { key: 'shopping',       label: 'Itens de compra',     description: 'Lista, nome, quantidade, preço, total, status' },
  { key: 'transactions',   label: 'Transações',          description: 'Uma aba por lista — descrição, valor, tipo, data, categoria' },
  { key: 'financialGoals', label: 'Metas financeiras',   description: 'Lista, nome, valor alvo, mês/ano, status' },
]

export function ExcelExportModal({ projects, tasks, sprints, habits, goals, notes, lists, onClose, onToast }: Props) {
  const [selected, setSelected] = useState<Set<DataKey>>(
    new Set(['projects', 'tasks', 'sprints', 'habits', 'goals', 'notes', 'shopping', 'transactions', 'financialGoals'])
  )
  const [loading, setLoading] = useState(false)

  const toggle = (key: DataKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === OPTIONS.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(OPTIONS.map((o) => o.key)))
    }
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      const wb = buildWorkbook(selected, projects, tasks, sprints, habits, goals, notes, lists)
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      const date = new Date().toISOString().split('T')[0]
      const result = await window.electronAPI.excel.export(buffer, `sagyou-export-${date}.xlsx`)
      if (result.success) {
        onToast?.('Exportado com sucesso')
        onClose()
      }
    } finally {
      setLoading(false)
    }
  }

  const allSelected = selected.size === OPTIONS.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[440px] rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#22c55e]/15 flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-[#e2e8f0]">Exportar para Excel</h2>
          </div>
          <button onClick={onClose} className="text-[#8892a4] hover:text-[#e2e8f0] transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Options */}
        <div className="flex-1 overflow-y-auto p-5 space-y-1.5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[#8892a4]">Selecione os dados a incluir no arquivo:</p>
            <button
              onClick={toggleAll}
              className="text-[11px] text-[#6366f1] hover:text-[#a5b4fc] transition-colors"
            >
              {allSelected ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>
          {OPTIONS.map((opt) => {
            const isActive = selected.has(opt.key)
            return (
              <button
                key={opt.key}
                onClick={() => toggle(opt.key)}
                className={`w-full flex items-start gap-3 px-3.5 py-2.5 rounded-lg border text-left transition-colors ${
                  isActive
                    ? 'border-[#6366f1]/50 bg-[#6366f1]/10'
                    : 'border-[#2a2d42] bg-[#0d0f18] hover:border-[#3a3e58]'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                  isActive ? 'bg-[#6366f1] border-[#6366f1]' : 'border-[#4a5068]'
                }`}>
                  {isActive && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm text-[#e2e8f0] font-medium">{opt.label}</p>
                  <p className="text-[11px] text-[#4a5068] mt-0.5">{opt.description}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[#2a2d42] shrink-0">
          <span className="text-xs text-[#4a5068]">
            {selected.size === 0 ? 'Nenhuma planilha selecionada' : `${selected.size} ${selected.size === 1 ? 'planilha' : 'planilhas'}`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleExport}
              disabled={selected.size === 0 || loading}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[#22c55e]/15 text-[#4ade80] hover:bg-[#22c55e]/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Exportando...
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Exportar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
