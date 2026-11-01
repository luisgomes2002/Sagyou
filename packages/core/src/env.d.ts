// The few web globals the core relies on. Node/Electron provide them natively;
// the phone gets them from polyfills loaded first in apps/mobile/index.ts
// (react-native-get-random-values, react-native-url-polyfill, structuredClone).
// Declared here, and not through lib "DOM", so nothing else from the browser
// sneaks into code that must also run on Hermes.
declare function structuredClone<T>(value: T): T

declare class URL {
  constructor(url: string, base?: string)
  readonly href: string
  readonly origin: string
  readonly protocol: string
  readonly username: string
  readonly password: string
  readonly hostname: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

interface AbortSignal {
  readonly aborted: boolean
}

declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

declare const AbortSignal: { timeout?: (ms: number) => AbortSignal }

declare class AbortController {
  readonly signal: AbortSignal
  abort(): void
}

declare function setTimeout(fn: () => void, ms: number): unknown
