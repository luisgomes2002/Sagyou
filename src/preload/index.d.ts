import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizedChange: (cb: (isMax: boolean) => void) => () => void
      }
      store: {
        load: () => Promise<{ projects: unknown[]; tasks: unknown[] }>
        save: (data: unknown) => Promise<void>
      }
      backup: {
        export: (backup: unknown) => Promise<{ success: boolean; cancelled?: boolean }>
        import: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }>
      }
      ai: {
        import: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }>
      }
    }
  }
}
