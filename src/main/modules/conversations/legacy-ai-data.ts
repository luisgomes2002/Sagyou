type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read-time migration only. Unknown keys deliberately survive so the first
 * config save cannot erase a field introduced by a newer or experimental build.
 */
export function normalizeLegacyAIConfig(value: unknown): RecordValue {
  if (!isRecord(value)) return {}
  const config = { ...value }
  // The native executor is retired; an old selection must not resurrect it.
  if (config.codeHarness === 'sagyou') config.codeHarness = 'codex'
  return config
}
