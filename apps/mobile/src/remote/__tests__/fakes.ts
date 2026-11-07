import type { ControlSecureStore, SecureOptions } from '../keys'

export interface FakeSecure extends ControlSecureStore {
  data: Map<string, string>
  writes: { key: string; options?: SecureOptions }[]
  reads: { key: string; options?: SecureOptions }[]
  failRead: Error | null
}

export function fakeSecure(): FakeSecure {
  const data = new Map<string, string>()
  const s: FakeSecure = {
    data,
    writes: [],
    reads: [],
    failRead: null,
    async getItemAsync(key, options) {
      s.reads.push({ key, options })
      if (s.failRead && options?.requireAuthentication) throw s.failRead
      return data.get(key) ?? null
    },
    async setItemAsync(key, value, options) {
      s.writes.push({ key, options })
      data.set(key, value)
    },
    async deleteItemAsync(key) {
      data.delete(key)
    }
  }
  return s
}
