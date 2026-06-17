import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectLink } from '../types'

interface Props {
  links: ProjectLink[]
  activeLinkId: string | null
  onSelect: (id: string) => void
}

export function ProjectLinksDropdown({ links, activeLinkId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
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

  const activeLink = links.find((l) => l.id === activeLinkId) ?? null

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen((v) => !v)
  }

  const handleCopy = (e: React.MouseEvent, url: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isUrl = (s: string) => /^https?:\/\//.test(s)

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors border ${
          activeLink
            ? 'border-[#6366f1]/40 bg-[#6366f1]/10 text-[#a5b4fc]'
            : 'border-[#2a2d42] bg-[#1e2235] text-[#8892a4] hover:text-[#e2e8f0]'
        }`}
        title="Links do projeto"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span className="max-w-[120px] truncate">
          {activeLink ? activeLink.label : 'Links'}
        </span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-[#2a2d42] bg-[#0d0f18] shadow-2xl py-1"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#4a5068]">
              Link ativo desta sessão
            </p>
            {links.length === 0 && (
              <p className="px-3 pb-3 text-xs text-[#8892a4] italic">Nenhum link cadastrado</p>
            )}
            {links.map((link) => {
              const isActive = link.id === activeLinkId
              return (
                <button
                  key={link.id}
                  onClick={() => { onSelect(link.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group ${
                    isActive ? 'bg-[#6366f1]/10' : 'hover:bg-[#1e2235]'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    isActive ? 'border-[#6366f1] bg-[#6366f1]' : 'border-[#4a5068]'
                  }`}>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-[#a5b4fc]' : 'text-[#e2e8f0]'}`}>
                      {link.label}
                    </p>
                    <p className="text-[11px] text-[#4a5068] truncate">{link.url}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUrl(link.url) && (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded text-[#8892a4] hover:text-[#a5b4fc]"
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
                      onClick={(e) => handleCopy(e, link.url)}
                      className="p-1 rounded text-[#8892a4] hover:text-[#a5b4fc]"
                      title="Copiar"
                    >
                      {copied ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
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
            {activeLink && (
              <>
                <div className="border-t border-[#2a2d42] my-1" />
                <button
                  onClick={(e) => { handleCopy(e, activeLink.url); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#a5b4fc] hover:bg-[#1e2235] transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copiar link ativo
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
