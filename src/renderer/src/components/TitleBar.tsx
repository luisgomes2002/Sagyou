import { useEffect, useState } from 'react'

const platform = window.electron.process.platform

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setIsMaximized)
    const unsub = window.electronAPI.window.onMaximizedChange(setIsMaximized)
    return unsub
  }, [])

  const minimize = () => window.electronAPI.window.minimize()
  const maximize = () => window.electronAPI.window.maximize()
  const close = () => window.electronAPI.window.close()

  return (
    <div
      className="flex items-center shrink-0 h-9 w-full bg-[#0d0f18] border-b border-[#2a2d42] select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Mac: traffic lights à esquerda */}
      {platform === 'darwin' && (
        <div
          className="flex items-center gap-1.5 px-3"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={close}
            className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition-all group flex items-center justify-center"
            title="Fechar"
          >
            <span className="opacity-0 group-hover:opacity-100 text-[#7d0000] text-[8px] leading-none font-bold">✕</span>
          </button>
          <button
            onClick={minimize}
            className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 transition-all group flex items-center justify-center"
            title="Minimizar"
          >
            <span className="opacity-0 group-hover:opacity-100 text-[#7d5000] text-[8px] leading-none font-bold">−</span>
          </button>
          <button
            onClick={maximize}
            className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition-all group flex items-center justify-center"
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
          >
            <span className="opacity-0 group-hover:opacity-100 text-[#006500] text-[8px] leading-none font-bold">
              {isMaximized ? '⤡' : '⤢'}
            </span>
          </button>
        </div>
      )}

      {/* Logo + título (centro) */}
      <div className="flex-1 flex items-center justify-center gap-2 pointer-events-none">
        <div className="w-4 h-4 rounded bg-[#6366f1] flex items-center justify-center shrink-0">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <rect x="3" y="3" width="7" height="18" rx="1" />
            <rect x="14" y="3" width="7" height="11" rx="1" />
            <rect x="14" y="18" width="7" height="3" rx="1" />
          </svg>
        </div>
        <span className="text-xs font-medium text-[#8892a4]">Sagyou</span>
      </div>

      {/* Windows / Linux: botões à direita */}
      {platform !== 'darwin' && (
        <div
          className="flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={minimize}
            className="w-10 h-9 flex items-center justify-center text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            title="Minimizar"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={maximize}
            className="w-10 h-9 flex items-center justify-center text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="13" height="13" rx="1" />
                <path d="M8 3V2a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="1" />
              </svg>
            )}
          </button>
          <button
            onClick={close}
            className="w-10 h-9 flex items-center justify-center text-[#8892a4] hover:text-white hover:bg-red-500 transition-colors"
            title="Fechar"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
