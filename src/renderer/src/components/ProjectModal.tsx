import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Project, ProjectLink } from '../types'
import { PROJECT_COLORS } from '../types'

interface Props {
  open: boolean
  project?: Project
  onSave: (name: string, description: string, color: string, links: ProjectLink[]) => void
  onClose: () => void
}

export function ProjectModal({ open, project, onSave, onClose }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0])
  const [links, setLinks] = useState<ProjectLink[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '')
      setDescription(project?.description ?? '')
      setColor(project?.color ?? PROJECT_COLORS[0])
      setLinks(project?.links ?? [])
      setNewLabel('')
      setNewUrl('')
    }
  }, [open, project])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), description.trim(), color, links)
  }

  const handleAddLink = () => {
    if (!newLabel.trim() || !newUrl.trim()) return
    setLinks((prev) => [...prev, { id: uuidv4(), label: newLabel.trim(), url: newUrl.trim() }])
    setNewLabel('')
    setNewUrl('')
  }

  const handleRemoveLink = (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  const handleLinkKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddLink() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[#2a2d42] shrink-0">
          <h2 className="text-base font-semibold text-[#e2e8f0]">
            {project ? 'Editar projeto' : 'Novo projeto'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Nome *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do projeto"
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-1.5">Descrição</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição opcional"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-2">Cor</label>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: color === c ? `2px solid ${c}` : 'none',
                      outlineOffset: '2px'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Links section */}
            <div>
              <label className="block text-xs font-medium text-[#8892a4] mb-2">
                Links do projeto
                <span className="ml-1.5 text-[#4a5068] font-normal">URLs ou caminhos de pastas</span>
              </label>

              {links.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {links.map((link) => (
                    <div key={link.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] group">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5068" strokeWidth="2" className="shrink-0">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#e2e8f0] font-medium truncate">{link.label}</p>
                        <p className="text-[11px] text-[#4a5068] truncate">{link.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLink(link.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#8892a4] hover:text-red-400"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={handleLinkKeyDown}
                  placeholder="Rótulo  (ex: Frontend PC Casa)"
                  className="w-full px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    onKeyDown={handleLinkKeyDown}
                    placeholder="URL ou caminho  (ex: /home/luis/projetos/app)"
                    className="flex-1 px-3 py-2 rounded-lg border border-[#2a2d42] bg-[#0d0f18] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleAddLink}
                    disabled={!newLabel.trim() || !newUrl.trim()}
                    className="px-3 py-2 rounded-lg bg-[#6366f1]/15 text-[#a5b4fc] text-sm hover:bg-[#6366f1]/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-5 pt-4 border-t border-[#2a2d42] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-[#6366f1] text-white font-medium hover:bg-[#5254c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {project ? 'Salvar' : 'Criar projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
