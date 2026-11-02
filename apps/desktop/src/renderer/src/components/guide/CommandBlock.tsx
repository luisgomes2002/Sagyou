import { useEffect, useState, type JSX } from 'react'

export const COPIED_MS = 2000

export function CommandBlock({ command, label }: { command: string; label?: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), COPIED_MS)
    return () => clearTimeout(timer)
  }, [state])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setState('copied')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="space-y-1">
      {label && <p className="text-sm text-[#999999]">{label}</p>}
      <div className="flex items-start gap-2 rounded-lg border border-[#2b2b31] bg-[#101014] p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-[#d4d4d4]">
          {command}
        </pre>
        <button
          type="button"
          aria-label="Copiar comando"
          onClick={() => void copy()}
          className="shrink-0 rounded-md bg-[#2a2a30] px-2.5 py-1 text-xs text-[#d4d4d4] hover:bg-[#303036]"
        >
          {state === 'copied' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {state === 'error' && (
        <p role="status" className="text-xs text-[#ec6a6a]">
          Não foi possível copiar.
        </p>
      )}
    </div>
  )
}
