import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectLink } from '../types'

interface Props {
  links: ProjectLink[]
  activeLinkIds: string[]
  onSelect: (id: string) => void
}

export function ProjectLinksDropdown({ links, activeLinkIds, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const activeLinks = links.filter((l) => activeLinkIds.includes(l.id))
  const hasActive = activeLinks.length > 0

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  const handleCopy = (e: React.MouseEvent, url: string, id: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const isUrl = (s: string) => /^https?:\/\//.test(s)

  const buttonLabel = (() => {
    if (activeLinks.length === 0) return 'Links'
    if (activeLinks.length === 1) return activeLinks[0].label
    return `${activeLinks.length} links`
  })()

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors border ${
          hasActive
            ? 'border-[#7c3aed]/40 bg-[#7c3aed]/10 text-[#a080f0]'
            : 'border-[#3b3b3b] bg-[#2a2a2a] text-[#999999] hover:text-[#d4d4d4]'
        }`}
        title="Links do projeto"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span className="max-w-[120px] truncate">{buttonLabel}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl py-1"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#666666]">
              Links ativos desta sessão
            </p>
            {links.length === 0 && (
              <p className="px-3 pb-3 text-xs text-[#999999] italic">Nenhum link cadastrado</p>
            )}
            {links.map((link) => {
              const isActive = activeLinkIds.includes(link.id)
              return (
                <button
                  key={link.id}
                  onClick={() => onSelect(link.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group ${
                    isActive ? 'bg-[#7c3aed]/10' : 'hover:bg-[#2a2a2a]'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                    isActive ? 'border-[#7c3aed] bg-[#7c3aed]' : 'border-[#666666]'
                  }`}>
                    {isActive && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-[#a080f0]' : 'text-[#d4d4d4]'}`}>
                      {link.label}
                    </p>
                    <p className="text-[11px] text-[#666666] truncate">{link.url}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUrl(link.url) && (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded text-[#999999] hover:text-[#a080f0]"
                        title="Abrir"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                    <button
                      onClick={(e) => handleCopy(e, link.url, link.id)}
                      className="p-1 rounded text-[#999999] hover:text-[#a080f0]"
                      title="Copiar"
                    >
                      {copied === link.id ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#46d478" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </button>
              )
            })}
            {activeLinks.length > 0 && (
              <>
                <div className="border-t border-[#3b3b3b] my-1" />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(activeLinks.map((l) => l.url).join('\n'))
                    setCopied('__all__')
                    setTimeout(() => { setCopied(null); setOpen(false) }, 1200)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#a080f0] hover:bg-[#2a2a2a] transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {copied === '__all__'
                    ? 'Copiado!'
                    : activeLinks.length === 1
                      ? 'Copiar link ativo'
                      : `Copiar ${activeLinks.length} links ativos`}
                </button>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
