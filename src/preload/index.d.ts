import type { ElectronAPI as ElectronToolkitAPI } from '@electron-toolkit/preload'
import type { SagyouElectronAPI } from './index'

declare global {
  interface Window {
    electron: ElectronToolkitAPI
    /**
     * Derived from the object exposed by preload, rather than maintained as a
     * second manual list of IPC methods.
     */
    electronAPI: SagyouElectronAPI
  }
}

export {}
