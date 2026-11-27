// What ai-config.json may hold. The retired API chat is gone, so no key of it is ever read,
// handed out or written back; everything else (agent settings and any key a newer build adds)
// survives. This is the only thing that stops `ai:config:set` from writing an API key to disk.

/** The keys that only the retired API chat used. */
export const LEGACY_API_CONFIG_KEYS = [
  'baseUrl',
  'apiKey',
  'model',
  'providerProfiles',
  'activeProviderProfileId',
  'legacyProfileMigrated',
  'chatProvider',
  'modelComplex',
  'maxSteps',
  'inputPricePer1M',
  'outputPricePer1M',
  'timeoutMs',
  'lastConversationId',
  'codeAgent'
] as const

export function stripLegacyApiConfig(value: unknown): {
  config: Record<string, unknown>
  changed: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { config: {}, changed: false }
  }
  const config = { ...(value as Record<string, unknown>) }
  let changed = false
  for (const key of LEGACY_API_CONFIG_KEYS) {
    if (key in config) {
      delete config[key]
      changed = true
    }
  }
  return { config, changed }
}

/**
 * The only shape this process ever hands out or writes: no API-chat keys. Unknown keys
 * deliberately survive, so the first save cannot erase a field from a newer build.
 */
export function agentOnlyConfig(value: unknown): Record<string, unknown> {
  const { config } = stripLegacyApiConfig(value)
  // The native executor is retired; an old selection must not resurrect it.
  if (config.codeHarness === 'sagyou') config.codeHarness = 'codex'
  return config
}
