/** Only browser URLs are handed to the operating system's protocol handler. */
export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
