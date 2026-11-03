// The control client's fetch, held like sync while an app update is pending:
// the messages, roles and ESP32-key routes wait for the new version, while the
// power routes always pass (they only reach the ESP32 through the Worker).
import type { FetchLike } from '@sagyou/core/sync/engine'

const HELD_ROUTE = /\/(control\/|roles(\/|$)|esp32-key$)/

export function heldControlFetch(fetch: FetchLike, isHeld: () => boolean): FetchLike {
  return (url, init) => {
    if (isHeld()) {
      let path = ''
      try {
        path = new URL(url).pathname
      } catch {
        path = ''
      }
      // The client turns a thrown fetch into 'offline'.
      if (HELD_ROUTE.test(path)) return Promise.reject(new Error('update pending'))
    }
    return fetch(url, init)
  }
}
