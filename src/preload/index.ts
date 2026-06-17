import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb: (isMax: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, isMax: boolean) => cb(isMax)
      ipcRenderer.on('window:maximized-change', handler)
      return () => ipcRenderer.removeListener('window:maximized-change', handler)
    }
  },
  store: {
    load: (): Promise<{ projects: unknown[]; tasks: unknown[] }> =>
      ipcRenderer.invoke('store:load'),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke('store:save', data)
  },
  backup: {
    export: (backup: unknown): Promise<{ success: boolean; cancelled?: boolean }> =>
      ipcRenderer.invoke('backup:export', backup),
    import: (): Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('backup:import')
  },
  ai: {
    import: (): Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('ai:import')
  },
  files: {
    upload: (): Promise<{ id: string; name: string; ext: string; size: number; createdAt: string }[]> =>
      ipcRenderer.invoke('files:upload'),
    delete: (id: string, ext: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('files:delete', id, ext),
    open: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:open', id, ext),
    openInBrowser: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:openInBrowser', id, ext),
    download: (id: string, name: string, ext: string): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('files:download', id, name, ext)
  },
  excel: {
    export: (buffer: ArrayBuffer, filename: string): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('excel:export', buffer, filename)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.electronAPI = api
}
