import { useEffect, useState } from 'react'
import { format, isPast, parseISO } from 'date-fns'
import { createPortal } from 'react-dom'
import type { Task, Column } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { useKanbanStore } from '../store/kanban'
import { formatDuration } from '../utils/time'

interface Props {
  open: boolean
  task: Task | null
  columns: Column[]
  onEdit: (task: Task) => void
  /** Hand the task to the assistant. Absent = the button isn't offered. */
  onSendToAI?: (task: Task) => void
  onClose: () => void
}

export function TaskViewModal({ open, task, columns, onEdit, onSendToAI, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const activeTimer = useKanbanStore((s) => s.activeTimer)
  const startTimer = useKanbanStore((s) => s.startTimer)
  const stopTimer = useKanbanStore((s) => s.stopTimer)

  const isRunning = !!task && activeTimer?.taskId === task.id

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxSrc) setLightboxSrc(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, lightboxSrc])

  if (!open || !task) return null

  const priority = PRIORITY_CONFIG[task.priority]
  const isOverdue = task.dueDate && isPast(parseISO(task.dueDate))
  const columnName = columns.find((c) => c.id === task.columnId)?.name ?? ''
  const images = task.images ?? []

  const sessionSeconds = isRunning ? Math.floor((Date.now() - activeTimer!.startedAt) / 1000) : 0
  const totalSeconds = (task.timeSpent ?? 0) + sessionSeconds

  const buildCopyText = () => {
    const lines: string[] = []
    lines.push(task.title)
    if (task.description) {
      lines.push('')
      lines.push(task.description)
    }
    lines.push('')
    const meta: string[] = []
    meta.push(`Prioridade: ${priority.label}`)
    if (task.dueDate) meta.push(`Vencimento: ${format(parseISO(task.dueDate), 'dd/MM/yyyy')}`)
    if (columnName) meta.push(`Coluna: ${columnName}`)
    lines.push(meta.join(' | '))
    if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(', ')}`)
    return lines.join('\n')
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildCopyText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42]">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${priority.bg} ${priority.color}`}>
              {priority.label}
            </span>
            {columnName && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#2a2d42] text-[#8892a4]">
                {columnName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onSendToAI && (
              <button
                onClick={() => { onClose(); onSendToAI(task) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#6366f1]/15 text-[#a5b4fc] border border-[#6366f1]/30 hover:bg-[#6366f1]/25 transition-colors"
                title="Abrir no chat da IA com o contexto desta task"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Pedir para a IA
              </button>
            )}
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                copied
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-[#1e2235] text-[#8892a4] border border-[#2a2d42] hover:text-[#e2e8f0] hover:border-[#3a3e58]'
              }`}
              title="Copiar para área de transferência"
            >
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copiado!
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copiar
                </>
              )}
            </button>
            <button
              onClick={() => { onClose(); onEdit(task) }}
              className="p-1.5 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
              title="Editar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <h2 className="text-base font-semibold text-[#e2e8f0] leading-snug">{task.title}</h2>

          {task.description ? (
            <p className="text-sm text-[#c4cad8] leading-relaxed whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-sm text-[#8892a4] italic">Sem descrição.</p>
          )}

          <div className="border-t border-[#2a2d42] pt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-1">Vencimento</p>
              {task.dueDate ? (
                <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-[#e2e8f0]'}`}>
                  {format(parseISO(task.dueDate), 'dd/MM/yyyy')}
                  {isOverdue && <span className="ml-1.5 text-[10px] font-normal">vencida</span>}
                </p>
              ) : (
                <p className="text-sm text-[#8892a4]">—</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-1">Criada em</p>
              <p className="text-sm text-[#e2e8f0]">{format(parseISO(task.createdAt), 'dd/MM/yyyy')}</p>
            </div>
            {task.completedAt && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-1">Concluída em</p>
                <p className="text-sm font-medium text-[#22c55e]">
                  {format(parseISO(task.completedAt), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
            )}
          </div>

          {/* Time tracking */}
          <div className="border-t border-[#2a2d42] pt-4">
            <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-3">Tempo gasto</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${isRunning ? 'bg-[#22c55e]/15 border border-[#22c55e]/30' : 'bg-[#1e2235] border border-[#2a2d42]'}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isRunning ? '#22c55e' : '#8892a4'} strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <p className={`text-base font-semibold tabular-nums font-mono ${isRunning ? 'text-[#22c55e]' : 'text-[#e2e8f0]'}`}>
                    {totalSeconds > 0 ? formatDuration(totalSeconds) : '—'}
                  </p>
                  {isRunning ? (
                    <p className="text-[10px] text-[#22c55e]/70 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse inline-block" />
                      Em andamento
                    </p>
                  ) : task.timeSpent ? (
                    <p className="text-[10px] text-[#8892a4] flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="opacity-60">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                      Pausado
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => isRunning ? stopTimer() : startTimer(task.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  isRunning
                    ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30 hover:bg-[#22c55e]/25'
                    : 'bg-[#1e2235] text-[#8892a4] border-[#2a2d42] hover:text-[#e2e8f0] hover:border-[#3a3e58]'
                }`}
              >
                {isRunning ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                    Pausar
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                    {task.timeSpent ? 'Retomar' : 'Iniciar'}
                  </>
                )}
              </button>
            </div>
          </div>

          {task.tags.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded bg-[#6366f1]/20 text-[#a5b4fc]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* images */}
          {images.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8892a4] mb-2">
                Imagens ({images.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightboxSrc(img.dataUrl)}
                    className="aspect-square rounded-lg overflow-hidden border border-[#2a2d42] hover:border-[#6366f1]/50 transition-colors bg-[#0d0f18] group/img relative"
                    title={img.name}
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                        className="opacity-0 group-hover/img:opacity-100 transition-opacity"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        <line x1="11" y1="8" x2="11" y2="14" />
                        <line x1="8" y1="11" x2="14" y2="11" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* copy preview */}
          <div className="rounded-lg bg-[#0d0f18] border border-[#2a2d42] p-3">
            <p className="text-[9px] uppercase tracking-wider text-[#8892a4]/60 mb-2">Preview — o que será copiado</p>
            <pre className="text-[11px] text-[#8892a4] leading-relaxed whitespace-pre-wrap font-mono">{buildCopyText()}</pre>
          </div>
        </div>
      </div>

      {/* lightbox */}
      {lightboxSrc && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => setLightboxSrc(null)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={lightboxSrc}
            alt="imagem ampliada"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </div>
  )
}
