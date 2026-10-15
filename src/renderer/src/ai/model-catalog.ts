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

export async function fetchModels(_config: AIConfig): Promise<string[]> {
  try {
    // The selected connection, including its credential, is resolved by main.
    const response = await window.electronAPI.ai.models()
    if (response.success && Array.isArray(response.models)) {
      return [...new Set(response.models)]
    }
  } catch {
    /* fall through to known models only */
  }
  return []
}
