import type { ChatMessage } from '../../../store/aiRun'

/** Nome de um chat a partir da sua primeira mensagem do usuário. */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? 'Conversa'
  return firstUser.slice(0, 60) || 'Conversa'
}

/** Tokens compactos: 980 → "980", 4210 → "4.2k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatProgress(step: number, maxSteps: number): string {
  return maxSteps === 0 ? String(step) : `${step}/${maxSteps}`
}

/** Duração curta: 45s, 12min, 2h05. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export type SessionStatus = 'running' | 'attention' | 'done' | 'failed'

export const STATUS_STYLE: Record<SessionStatus, { dot: string; label: string; text: string }> = {
  running: { dot: 'bg-[#a080f0] animate-pulse', label: 'Em execução', text: 'text-[#c4b5fd]' },
  attention: { dot: 'bg-[#f0b820] animate-pulse', label: 'Precisa de você', text: 'text-[#f0b820]' },
  done: { dot: 'bg-[#46d478]', label: 'Concluída', text: 'text-[#46d478]' },
  failed: { dot: 'bg-[#e04040]', label: 'Falhou', text: 'text-[#e04040]' }
}
