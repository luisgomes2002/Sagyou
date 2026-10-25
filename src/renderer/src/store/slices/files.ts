import type { StateCreator } from 'zustand'
import type { StoredFile, FinancialTable } from '../../types'
import { applyFinancialTransactionEdit } from '../../utils/financialRecord'

export interface FilesSlice {
  files: StoredFile[]
  addFiles: (files: StoredFile[]) => void
  removeFile: (id: string) => void
}

export const createFilesSlice: StateCreator<
  FilesSlice & { lists: FinancialTable[]; _persist: () => void },
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
    const at = new Date().toISOString()
    set((s) => ({
      files: s.files.filter((f) => f.id !== id),
      lists: s.lists.map((list) => ({
        ...list,
        transactions: list.transactions.map((tx) =>
          tx.receiptFileIds?.includes(id)
            ? applyFinancialTransactionEdit(
                tx,
                { receiptFileIds: tx.receiptFileIds.filter((fileId) => fileId !== id) },
                at
              )
            : tx
        )
      }))
    }))
    get()._persist()
  }
})
