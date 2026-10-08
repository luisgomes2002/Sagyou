import type { AIConfig } from './agent'

/** A model selection may suggest a provider URL without changing a custom endpoint. */
export const MODEL_PROVIDER: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  gpt: 'https://api.openai.com',
  o1: 'https://api.openai.com',
  o3: 'https://api.openai.com',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  llama: 'https://api.llama-api.com',
  mistral: 'https://api.mistral.ai',
  codestral: 'https://api.mistral.ai',
  qwen: 'https://api.qwen.ai'
}

export function providerForModel(model: string): string | null {
  const key = Object.keys(MODEL_PROVIDER).find((prefix) => model.startsWith(prefix))
  return key ? MODEL_PROVIDER[key] : null
}

/** Known models remain visible when a compatible provider omits GET /models. */
const KNOWN_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3-mini',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-opus-4-20250514',
  'claude-3-opus-latest',
  'claude-3-haiku-20240307',
  'gemini-2.5-pro-exp-03-25',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'llama-3.3-70b-instruct',
  'llama-3.1-8b-instruct',
  'mistral-large-latest',
  'mistral-small-latest',
  'codestral-latest',
  'qwen2.5-coder-32b-instruct',
  'qwen2.5-72b-instruct'
]

export async function fetchModels(config: AIConfig): Promise<string[]> {
  try {
    const response = await window.electronAPI.ai.models({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey
    })
    if (response.success && Array.isArray(response.models)) {
      return [...new Set([...KNOWN_MODELS, ...response.models])]
    }
  } catch {
    /* fall through to known models only */
  }
  return KNOWN_MODELS
}
