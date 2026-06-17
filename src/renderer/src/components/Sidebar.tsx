import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../types'

type ActiveView = 'board' | 'canvas' | 'done' | 'goals' | 'habits' | 'financial' | 'upcoming' | 'reports' | 'files'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  activeView: ActiveView
  onSelectProject: (id: string) => void
  onChangeView: (view: ActiveView) => void
  onOpenSearch: () => void
  onNewProject: () => void
  onEditProject: (project: Project) => void
  onMoveProject: (id: string, direction: 'up' | 'down') => void
  onDeleteProject: (project: Project) => void
  onExportBackup: () => void
  onImportBackup: () => void
  onImportAI: () => void
  onExportExcel: () => void
}

export function Sidebar({
  projects,
  activeProjectId,
  activeView,
  onSelectProject,
  onChangeView,
  onOpenSearch,
  onNewProject,
  onEditProject,
  onMoveProject,
  onDeleteProject,
  onExportBackup,
  onImportBackup,
  onImportAI,
  onExportExcel
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState({ top: 0, right: 0 })
  const [showJsonExample, setShowJsonExample] = useState(false)
  const [jsonExamplePos, setJsonExamplePos] = useState({ top: 0, left: 0 })
  const [jsonCopied, setJsonCopied] = useState(false)
  const jsonInfoRef = useRef<HTMLButtonElement>(null)

  const JSON_COPY_TEXT = `{
  "tasks": [
    {
      "title": "Implementar login",
      "description": "Tela de autenticação com JWT.",
      "priority": "high",
      "dueDate": "2026-07-15",
      "tags": ["auth", "frontend"],
      "column": "In Progress",
      "sprint": "Sprint 1"
    },
    {
      "title": "Criar testes unitários",
      "priority": "medium",
      "tags": ["testes"],
      "column": "Backlog"
    }
  ]
}

Campos:
- priority — low · medium · high · urgent
- column — nome exato da coluna no projeto (ex: "In Progress")
- sprint — nome exato da sprint (ex: "Sprint 1"). Opcional.
- dueDate — formato YYYY-MM-DD. Opcional.
- tags — use as tags relevantes para o contexto. Tags disponíveis por área:

  Dev: frontend, backend, bug, fix, feat, refactor, api, design, mobile, devops, testes, docs, deploy, auth, security, performance, infra, ipc, store, utils, dnd, memoization, correctness, idempotency, query-optimization, redis, jwt, reports, heatmap, due-date, tags, sprints

  Estudo: estudo, leitura, revisão, resumo, prova, pesquisa, aula, curso, faculdade, idioma, exercício-mental, flashcard, vocabulário, gramática, prática, escrita, listening, tradução

  Trabalho: reunião, relatório, prazo, cliente, apresentação, email, planejamento, meta, entrega, revisão, feedback, onboarding, contrato, proposta, sprint, retrospectiva

  Saúde: exercício, academia, dieta, médico, sono, saúde mental, hidratação, corrida, alongamento, meditação, consulta, exame, suplemento, descanso

  Casa & Vida: compras, casa, limpeza, contas, família, social, lazer, viagem, alimentação, pet, manutenção, organização, decoração, mudança, vizinhança

  Finanças: investimento, gasto, economia, imposto, assinatura, renda extra, orçamento, dívida, cartão, poupança, declaração, recibo, transferência

  Pessoal: hábito, rotina, projeto pessoal, criatividade, foco, urgente, importante, ideia, meta pessoal, lembrete, reflexão, diário, gratidão, planejamento semanal

Gere tarefas para cada parte desse projeto, não deixe as tarefas muito granuladas e se o assunto de uma para outra for muito diferente separe em arquivos json diferentes, por exemplo na área de desenvolvimento tem a parte de testes, refatoração e nova feature, cada uma dessas é um arquivo separado.`

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON_COPY_TEXT)
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 2000)
  }

  const handleToggleJsonExample = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!showJsonExample && jsonInfoRef.current) {
      const rect = jsonInfoRef.current.getBoundingClientRect()
      setJsonExamplePos({ top: rect.top, left: rect.right + 8 })
    }
    setShowJsonExample((v) => !v)
  }

  const handleOpenProjectMenu = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (projectMenuId === projectId) {
      setProjectMenuId(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setProjectMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setProjectMenuId(projectId)
  }

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-[#13151f] border-r border-[#2a2d42]">
      {/* logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#2a2d42]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#6366f1] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="11" rx="1" />
              <rect x="14" y="18" width="7" height="3" rx="1" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[#e2e8f0]">Sagyou</span>
        </div>

        {/* import/export menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            title="Opções"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="19" cy="12" r="1" fill="currentColor" />
              <circle cx="5" cy="12" r="1" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-8 z-20 w-44 rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-xl py-1">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                  Backup
                </p>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onExportBackup() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Exportar backup
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#4ade80] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onExportExcel() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  Exportar Excel
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onImportBackup() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 5 17 10" />
                    <line x1="12" y1="5" x2="12" y2="17" />
                  </svg>
                  Importar backup
                </button>
                <div className="border-t border-[#2a2d42] my-1" />
                <div className="flex items-center justify-between px-3 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                    JSON
                  </p>
                  <button
                    ref={jsonInfoRef}
                    className={`transition-colors ${showJsonExample ? 'text-[#6366f1]' : 'text-[#8892a4] hover:text-[#6366f1]'}`}
                    title="Ver exemplo de JSON"
                    onClick={handleToggleJsonExample}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>
                </div>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); setShowJsonExample(false); onImportAI() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Importar JSON
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <button
        onClick={onOpenSearch}
        className="flex items-center gap-2 mx-3 my-2 px-3 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-[#8892a4] text-xs hover:border-[#6366f1]/50 hover:text-[#e2e8f0] transition-colors w-[calc(100%-1.5rem)]"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="text-[9px] px-1 py-0.5 rounded bg-[#1e2235] border border-[#2a2d42] font-sans">
          Ctrl K
        </kbd>
      </button>

      {/* view nav */}
      <div className="grid grid-cols-2 gap-1 px-3 py-2 border-b border-[#2a2d42]">
        <button
          onClick={() => onChangeView('board')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'board'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="18" rx="1" />
            <rect x="14" y="3" width="7" height="11" rx="1" />
            <rect x="14" y="18" width="7" height="3" rx="1" />
          </svg>
          Board
        </button>
        <button
          onClick={() => onChangeView('canvas')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'canvas'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
          Canvas
        </button>
        <button
          onClick={() => onChangeView('upcoming')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'upcoming'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Próximas
        </button>
        <button
          onClick={() => onChangeView('done')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'done'
              ? 'bg-[#22c55e]/15 text-[#4ade80]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Concluídas
        </button>
        <button
          onClick={() => onChangeView('goals')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'goals'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          Metas
        </button>
        <button
          onClick={() => onChangeView('habits')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'habits'
              ? 'bg-[#22c55e]/15 text-[#4ade80]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Hábitos
        </button>
        <button
          onClick={() => onChangeView('financial')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'financial'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Financeiro
        </button>
        <button
          onClick={() => onChangeView('reports')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'reports'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Relatórios
        </button>
      </div>

      {/* project list */}
      <div className="flex-1 overflow-y-auto py-2">
        <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
          Projetos
        </p>
        {projects.length === 0 && (
          <p className="px-4 text-xs text-[#8892a4] italic">Nenhum projeto ainda</p>
        )}
        {[...projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((project) => (
          <div key={project.id} className="relative group">
            <button
              onClick={() => onSelectProject(project.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                activeProjectId === project.id
                  ? 'bg-[#6366f1]/15 text-[#e2e8f0]'
                  : 'text-[#8892a4] hover:bg-[#1e2235] hover:text-[#e2e8f0]'
              }`}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate flex-1">{project.name}</span>
            </button>

            <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-opacity ${projectMenuId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button
                onClick={(e) => handleOpenProjectMenu(e, project.id)}
                className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" fill="currentColor" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" />
                  <circle cx="12" cy="19" r="1" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* JSON example portal */}
      {showJsonExample && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setShowJsonExample(false)} />
          <div
            className="fixed z-50 w-96 rounded-xl border border-[#2a2d42] bg-[#0d0f18] shadow-2xl"
            style={{ top: jsonExamplePos.top, left: jsonExamplePos.left }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d42]">
              <span className="text-xs font-semibold text-[#6366f1] uppercase tracking-wider">Formato esperado — JSON</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyJson}
                  className="flex items-center gap-1 text-[10px] text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                  title="Copiar tudo"
                >
                  {jsonCopied ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="text-[#6366f1]">Copiado</span>
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>Copiar tudo</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowJsonExample(false)}
                  className="text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-4">
              <pre className="text-[11px] text-[#a5b4fc] leading-relaxed font-mono bg-[#13151f] rounded-lg p-3 border border-[#2a2d42] overflow-x-auto">{`{
  "tasks": [
    {
      "title": "Implementar login",
      "description": "Tela de autenticação com JWT.",
      "priority": "high",
      "dueDate": "2026-07-15",
      "tags": ["auth", "frontend"],
      "column": "In Progress",
      "sprint": "Sprint 1"
    },
    {
      "title": "Criar testes unitários",
      "priority": "medium",
      "tags": ["testes"],
      "column": "Backlog"
    }
  ]
}`}</pre>
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">priority</span> — <span className="text-[#a5b4fc]">low</span> · <span className="text-[#a5b4fc]">medium</span> · <span className="text-[#a5b4fc]">high</span> · <span className="text-[#a5b4fc]">urgent</span>
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">column</span> — nome exato da coluna no projeto (ex: <span className="text-[#a5b4fc]">"In Progress"</span>)
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">sprint</span> — nome exato da sprint (ex: <span className="text-[#a5b4fc]">"Sprint 1"</span>). Opcional.
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">dueDate</span> — formato <span className="text-[#a5b4fc]">YYYY-MM-DD</span>. Opcional.
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">tags</span> — incluídas no "Copiar tudo" por área (Dev, Estudo, Trabalho, Saúde, Casa & Vida, Finanças, Pessoal)
                </p>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* project context menu portal */}
      {projectMenuId && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setProjectMenuId(null)} />
          <div
            className="fixed z-50 w-36 rounded-lg border border-[#2a2d42] bg-[#13151f] shadow-xl py-1"
            style={{ top: projectMenuPos.top, right: projectMenuPos.right }}
          >
            {(() => {
              const sorted = [...projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              const project = sorted.find((p) => p.id === projectMenuId)
              if (!project) return null
              const idx = sorted.findIndex((p) => p.id === projectMenuId)
              return (
                <div>
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                    onClick={() => { setProjectMenuId(null); onEditProject(project) }}
                  >
                    Editar
                  </button>
                  <button
                    disabled={idx === 0}
                    className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => { onMoveProject(project.id, 'up'); setProjectMenuId(null) }}
                  >
                    ↑ Mover para cima
                  </button>
                  <button
                    disabled={idx === sorted.length - 1}
                    className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => { onMoveProject(project.id, 'down'); setProjectMenuId(null) }}
                  >
                    ↓ Mover para baixo
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                    onClick={() => { setProjectMenuId(null); onDeleteProject(project) }}
                  >
                    Deletar
                  </button>
                </div>
              )
            })()}
          </div>
        </>,
        document.body
      )}

      {/* new project button */}
      <div className="p-3 border-t border-[#2a2d42]">
        <button
          onClick={onNewProject}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm text-[#6366f1] border border-[#6366f1]/30 hover:bg-[#6366f1]/10 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo projeto
        </button>
      </div>
    </aside>
  )
}
