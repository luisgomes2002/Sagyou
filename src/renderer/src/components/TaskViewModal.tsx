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
  const [imageData, setImageData] = useState<Record<string, string>>({})
  const [, setTick] = useState(0)

  const activeTimers = useKanbanStore((s) => s.activeTimers)
  const startTimer = useKanbanStore((s) => s.startTimer)
  const stopTimer = useKanbanStore((s) => s.stopTimer)

  const timer = task ? activeTimers.find((t) => t.taskId === task.id) : undefined
  const isRunning = !!timer

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

  // Load the task's image bytes from disk on demand for display (the DB holds
  // only metadata). setState only in the promise callback (like AIView's
  // loadImagesFor) — a fresh map replaces the previous task's, no sync reset.
  useEffect(() => {
    if (!open) return
    Promise.all(
      (task?.images ?? []).map(
        async (img) => [img.id, await window.electronAPI.taskImages.get(img.id, img.ext)] as const
      )
    ).then((loaded) => {
      const next: Record<string, string> = {}
      for (const [id, res] of loaded) if ('dataUrl' in res) next[id] = res.dataUrl
      setImageData(next)
    })
  }, [open, task])

  if (!open || !task) return null

  const priority = PRIORITY_CONFIG[task.priority]
  const isOverdue = task.dueDate && isPast(parseISO(task.dueDate))
  const columnName = columns.find((c) => c.id === task.columnId)?.name ?? ''
  const images = task.images ?? []

  const sessionSeconds = timer ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0
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
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b]">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${priority.bg} ${priority.color}`}>
              {priority.label}
            </span>
            {columnName && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#3b3b3b] text-[#999999]">
                {columnName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onSendToAI && (
              <button
                onClick={() => { onClose(); onSendToAI(task) }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#7c3aed]/15 text-[#a080f0] border border-[#7c3aed]/30 hover:bg-[#7c3aed]/25 transition-colors"
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
                  ? 'bg-[#46d478]/20 text-[#46d478] border border-[#46d478]/30'
                  : 'bg-[#2a2a2a] text-[#999999] border border-[#3b3b3b] hover:text-[#d4d4d4] hover:border-[#555555]'
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
              className="p-1.5 rounded-lg text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
              title="Editar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
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
          <h2 className="text-base font-semibold text-[#d4d4d4] leading-snug">{task.title}</h2>

          {task.description ? (
            <p className="text-sm text-[#d4d4d4] leading-relaxed whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-sm text-[#999999] italic">Sem descrição.</p>
          )}

          <div className="border-t border-[#3b3b3b] pt-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-1">Vencimento</p>
              {task.dueDate ? (
                <p className={`text-sm font-medium ${isOverdue ? 'text-[#e04040]' : 'text-[#d4d4d4]'}`}>
                  {format(parseISO(task.dueDate), 'dd/MM/yyyy')}
                  {isOverdue && <span className="ml-1.5 text-[10px] font-normal">vencida</span>}
                </p>
              ) : (
                <p className="text-sm text-[#999999]">-</p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-1">Criada em</p>
              <p className="text-sm text-[#d4d4d4]">{format(parseISO(task.createdAt), 'dd/MM/yyyy')}</p>
            </div>
            {task.completedAt && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-1">Concluída em</p>
                <p className="text-sm font-medium text-[#20b858]">
                  {format(parseISO(task.completedAt), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
            )}
          </div>

          {/* Time tracking */}
          <div className="border-t border-[#3b3b3b] pt-4">
            <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-3">Tempo gasto</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${isRunning ? 'bg-[#20b858]/15 border border-[#20b858]/30' : 'bg-[#2a2a2a] border border-[#3b3b3b]'}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isRunning ? '#20b858' : '#999999'} strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <p className={`text-base font-semibold tabular-nums font-mono ${isRunning ? 'text-[#20b858]' : 'text-[#d4d4d4]'}`}>
                    {totalSeconds > 0 ? formatDuration(totalSeconds) : '-'}
                  </p>
                  {isRunning ? (
                    <p className="text-[10px] text-[#20b858]/70 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#20b858] animate-pulse inline-block" />
                      Em andamento
                    </p>
                  ) : task.timeSpent ? (
                    <p className="text-[10px] text-[#999999] flex items-center gap-1">
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
                onClick={() => isRunning ? stopTimer(task.id) : startTimer(task.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  isRunning
                    ? 'bg-[#20b858]/15 text-[#20b858] border-[#20b858]/30 hover:bg-[#20b858]/25'
                    : 'bg-[#2a2a2a] text-[#999999] border-[#3b3b3b] hover:text-[#d4d4d4] hover:border-[#555555]'
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
              <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded bg-[#7c3aed]/20 text-[#a080f0]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* images */}
          {images.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#999999] mb-2">
                Imagens ({images.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => imageData[img.id] && setLightboxSrc(imageData[img.id])}
                    className="aspect-square rounded-lg overflow-hidden border border-[#3b3b3b] hover:border-[#7c3aed]/50 transition-colors bg-[#1b1b1b] group/img relative"
                    title={img.name}
                  >
                    <img
                      src={imageData[img.id]}
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
          <div className="rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] p-3">
            <p className="text-[9px] uppercase tracking-wider text-[#999999]/60 mb-2">Preview: o que será copiado</p>
            <pre className="text-[11px] text-[#999999] leading-relaxed whitespace-pre-wrap font-mono">{buildCopyText()}</pre>
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
