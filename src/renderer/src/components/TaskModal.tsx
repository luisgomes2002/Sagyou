import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task, Priority, Column, Sprint, TaskImage } from '../types'
import { PRIORITY_CONFIG, DEFAULT_TAGS } from '../types'
import { toTaskImageDataUrl } from '../utils/images'

interface Props {
  open: boolean
  task?: Task
  columns: Column[]
  sprints: Sprint[]
  defaultColumnId?: string
  defaultTitle?: string
  onSave: (data: {
    title: string
    description: string
    priority: Priority
    dueDate: string
    tags: string[]
    columnId: string
    sprintId: string
    images: TaskImage[]
  }) => void
  onClose: () => void
}

export function TaskModal({ open, task, columns, sprints, defaultColumnId, defaultTitle, onSave, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [columnId, setColumnId] = useState('')
  const [sprintId, setSprintId] = useState('')
  const [images, setImages] = useState<TaskImage[]>([])
  // id -> dataUrl for display only. Existing images load their bytes from disk
  // on open; a newly-added image caches its downscaled dataUrl here (and on the
  // TaskImage.dataUrl field) until save writes it to disk. The DB never holds bytes.
  const [imageData, setImageData] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeSprint = sprints.find((s) => !s.closedAt)

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? defaultTitle ?? '')
      setDescription(task?.description ?? '')
      setPriority(task?.priority ?? 'medium')
      setDueDate(task?.dueDate ?? '')
      setTags(task?.tags ?? [])
      setTagInput('')
      setColumnId(task?.columnId ?? defaultColumnId ?? columns[0]?.id ?? '')
      setSprintId(task ? (task.sprintId ?? '') : (activeSprint?.id ?? ''))
      setImages(task?.images ?? [])
      // Load existing images' bytes from disk for the previews. setState only in
      // the promise callback (matches AIView's loadImagesFor); the fresh map
      // replaces any previous one, so no synchronous reset is needed.
      Promise.all(
        (task?.images ?? []).map(
          async (img) => [img.id, await window.electronAPI.taskImages.get(img.id, img.ext)] as const
        )
      ).then((loaded) => {
        const next: Record<string, string> = {}
        for (const [id, res] of loaded) if ('dataUrl' in res) next[id] = res.dataUrl
        // Merge, not replace: a just-added image (handleFileChange) must survive
        // this load resolving late. Stale keys from a prior task are unused.
        setImageData((d) => ({ ...d, ...next }))
      })
    }
  }, [open, task, defaultTitle, defaultColumnId, columns])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    // Persist newly-added images (they carry a dataUrl) to disk now; existing
    // images already have a file. Writing on save (not on add) keeps cancel clean.
    const finalImages: TaskImage[] = []
    for (const img of images) {
      if (img.dataUrl) {
        const res = await window.electronAPI.taskImages.save(img.dataUrl)
        if ('error' in res) continue // couldn't save → drop it, never store a dangling ref
        finalImages.push({ id: res.id, name: img.name, ext: res.ext, size: res.size, addedAt: img.addedAt })
      } else {
        finalImages.push(img)
      }
    }
    // Delete the files of existing images the user removed (the task no longer
    // references them; nothing else does).
    const keptIds = new Set(finalImages.map((i) => i.id))
    const dropped = (task?.images ?? [])
      .filter((o) => !keptIds.has(o.id))
      .map((o) => ({ id: o.id, ext: o.ext }))
    if (dropped.length) await window.electronAPI.taskImages.delete(dropped)
    onSave({ title: title.trim(), description: description.trim(), priority, dueDate, tags, columnId, sprintId, images: finalImages })
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim().replace(/,/g, '')
      if (newTag && !tags.includes(newTag)) {
        setTags([...tags, newTag])
      }
      setTagInput('')
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag))

  const toggleSuggestedTag = (tag: string) => {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    for (const file of files) {
      try {
        // Downscale here (JPEG 1600px); the bytes hit disk only on save.
        const dataUrl = await toTaskImageDataUrl(file)
        const id = uuidv4()
        setImages((prev) => [
          ...prev,
          { id, name: file.name, ext: '', size: file.size, addedAt: new Date().toISOString(), dataUrl }
        ])
        setImageData((d) => ({ ...d, [id]: dataUrl }))
      } catch {
        /* skip an image that can't be read/decoded */
      }
    }
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
    setImageData((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#3b3b3b]">
          <h2 className="text-base font-semibold text-[#d4d4d4]">
            {task ? 'Editar task' : 'Nova task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* title */}
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da task"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          {/* description */}
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva a task..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors resize-none"
            />
          </div>

          {/* column + priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Coluna</label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* due date */}
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Data de vencimento</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors [color-scheme:dark]"
            />
          </div>

          {/* sprint */}
          {sprints.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Sprint</label>
              <select
                value={sprintId}
                onChange={(e) => setSprintId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                <option value="">Sem sprint</option>
                {sprints.filter((s) => !s.closedAt).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (ativa)</option>
                ))}
                {sprints.filter((s) => s.closedAt).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (encerrada)</option>
                ))}
              </select>
            </div>
          )}

          {/* tags */}
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">
              Tags <span className="font-normal">(Enter ou vírgula para adicionar)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] min-h-[40px] focus-within:border-[#7c3aed] transition-colors">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[#7c3aed]/20 text-[#a080f0]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-white transition-colors leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? 'frontend, bug, ...' : ''}
                className="flex-1 min-w-[100px] bg-transparent text-sm text-[#d4d4d4] placeholder-[#999999] outline-none"
              />
            </div>

            {/* suggested tags */}
            <div className="mt-2 space-y-1.5">
              {DEFAULT_TAGS.map((group) => (
                <div key={group.label} className="flex flex-wrap items-center gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#999999]/60 w-14 shrink-0">
                    {group.label}
                  </span>
                  {group.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleSuggestedTag(tag)}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                        tags.includes(tag)
                          ? 'bg-[#7c3aed]/30 text-[#a080f0] border border-[#7c3aed]/50'
                          : 'bg-[#2a2a2a] text-[#999999] border border-transparent hover:border-[#3b3b3b] hover:text-[#d4d4d4]'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* images */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[#999999]">
                Imagens {images.length > 0 && <span className="text-[#7c3aed]">({images.length})</span>}
              </label>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2 max-h-48 overflow-y-auto">
                {images.map((img) => (
                  <div key={img.id} className="relative group/img aspect-square rounded-lg overflow-hidden border border-[#3b3b3b] bg-[#1b1b1b]">
                    <img
                      src={imageData[img.id]}
                      alt={img.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-[#e04040] text-xs leading-none"
                      title="Remover imagem"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-[#3b3b3b] text-[#999999] text-xs hover:border-[#7c3aed]/50 hover:text-[#a080f0] hover:bg-[#7c3aed]/5 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Adicionar imagens
            </button>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {task ? 'Salvar' : 'Criar task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
