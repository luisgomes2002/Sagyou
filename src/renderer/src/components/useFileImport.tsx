import { useRef, useState } from 'react'
import { useKanbanStore } from '../store/kanban'
import type { StoredFile } from '../types'
import {
  planImport,
  uniqueCopyName,
  type ImportItem,
  type StagedFile
} from '../utils/file-duplicates'
import { DuplicateFileDialog, type Decision, type Question } from './DuplicateFileDialog'

export interface ImportOutcome {
  files: StoredFile[]
  /** Chosen files main could not import (expired token, copy failure). */
  failed: number
}

/**
 * Settles staged files (from files.pick or files.stageDropped) into the scope
 * a screen shows: a project's files, or the general ones when `scopeProjectId`
 * is null. Files with a free name are imported right away; names already in
 * that scope are asked about one by one. Every staged token is either imported
 * or discarded, and imports run one at a time so their dialogs never overlap.
 */
export function useFileImport(scopeProjectId: string | null): {
  runImport: (result: { staged: StagedFile[] }) => Promise<ImportOutcome>
  dialog: React.ReactNode
} {
  const addFiles = useKanbanStore((s) => s.addFiles)
  const [question, setQuestion] = useState<Question | null>(null)
  const answer = useRef<((decision: Decision) => void) | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const ask = (q: Question): Promise<Decision> =>
    new Promise((resolve) => {
      answer.current = resolve
      setQuestion(q)
    })

  const decide = (decision: Decision): void => {
    setQuestion(null)
    answer.current?.(decision)
    answer.current = null
  }

  const importItems = async (items: ImportItem[]): Promise<ImportOutcome> => {
    if (!items.length) return { files: [], failed: 0 }
    const imported = await window.electronAPI.files.import(items)
    const stored: StoredFile[] = scopeProjectId
      ? imported.map((file) => ({ ...file, projectId: scopeProjectId }))
      : imported
    if (stored.length) addFiles(stored)
    return { files: stored, failed: items.length - stored.length }
  }

  const settle = async (staged: StagedFile[]): Promise<ImportOutcome> => {
    // Read the store now, not from the render: a queued import must see what
    // the previous one just added.
    const scopeNames = useKanbanStore
      .getState()
      .files.filter((f) => (scopeProjectId ? f.projectId === scopeProjectId : !f.projectId))
      .map((f) => f.name)
    const { direct, duplicates } = planImport(staged, scopeNames)
    // Free names go in before any question, so a dialog left open can't
    // expire their tokens.
    const first = await importItems(direct)
    const taken = [...scopeNames, ...direct.map((item) => item.name)]
    const copies: ImportItem[] = []
    const toDiscard: string[] = []
    let forRest: boolean | null = null

    for (const [i, duplicate] of duplicates.entries()) {
      let copy = forRest
      if (copy === null) {
        const decision = await ask({ name: duplicate.name, remaining: duplicates.length - 1 - i })
        copy = decision.copy
        if (decision.applyToRest) forRest = decision.copy
      }
      if (copy) {
        const name = uniqueCopyName(duplicate.name, taken)
        taken.push(name)
        copies.push({ token: duplicate.token, name })
      } else toDiscard.push(duplicate.token)
    }

    if (toDiscard.length) await window.electronAPI.files.discard(toDiscard)
    const second = await importItems(copies)
    return { files: [...first.files, ...second.files], failed: first.failed + second.failed }
  }

  const runImport = ({ staged }: { staged: StagedFile[] }): Promise<ImportOutcome> => {
    const run = queue.current.then(() => settle(staged))
    queue.current = run.catch(() => {})
    return run
  }

  const dialog = question ? (
    <DuplicateFileDialog
      key={`${question.name}:${question.remaining}`}
      question={question}
      inProject={scopeProjectId !== null}
      onDecide={decide}
    />
  ) : null

  return { runImport, dialog }
}
