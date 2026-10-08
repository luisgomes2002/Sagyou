import type { ChatMessage } from '../store/aiRun'
import type { AIConfig, TokenUsage } from '../ai/agent'

export type StatusState = 'remark' | 'running' | 'done'

/** An interrupted tool must stop appearing active when its run has ended. */
export function statusState(message: ChatMessage, busy: boolean): StatusState {
  if (message.done === undefined) return 'remark'
  return message.done === false && busy ? 'running' : 'done'
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}

/** This is a display estimate, not a persisted financial amount. */
export function estimateCost(usage: TokenUsage, config: AIConfig): number | null {
  const { inputPricePer1M: inputPrice, outputPricePer1M: outputPrice } = config
  // Both prices are required; otherwise half the tokens would silently cost zero.
  if (typeof inputPrice !== 'number' || typeof outputPrice !== 'number') return null
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null
  const outputTokens = usage.completionTokens + (usage.reasoningTokens ?? 0)
  return (usage.promptTokens / 1e6) * inputPrice + (outputTokens / 1e6) * outputPrice
}

export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
