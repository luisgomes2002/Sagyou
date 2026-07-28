import type { StateCreator } from 'zustand'
import type { StoredFile } from '../../types'

export interface FilesSlice {
  files: StoredFile[]
  addFiles: (files: StoredFile[]) => void
  removeFile: (id: string) => void
}

export const createFilesSlice: StateCreator<
  FilesSlice & { _persist: () => void },
  [],
  [],
  FilesSlice
> = (set, get) => ({
  files: [],

  addFiles: (files) => {
    set((s) => ({ files: [...s.files, ...files] }))
    get()._persist()
  },

  removeFile: (id) => {
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }))
    get()._persist()
  }
})
