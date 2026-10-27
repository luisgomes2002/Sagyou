import { useRef, useState } from 'react'
import { useKanbanStore } from '../store/kanban'
import type { StoredFile } from '../types'
import { planImport, uniqueCopyName, type ImportItem, type StagedFile } from '../utils/file-duplicates'
import { DuplicateFileDialog, type Decision, type Question } from './DuplicateFileDialog'

/**
 * Settles staged files (from files.pick or files.stageDropped) into the scope
 * a screen shows: a project's files, or the general ones when `scopeProjectId`
 * is null. Names already in that scope are asked about one by one; every
 * staged token is either imported or discarded.
 */
export function useFileImport(scopeProjectId: string | null): {
  runImport: (result: { staged: StagedFile[] }) => Promise<StoredFile[]>
  dialog: React.ReactNode
} {
  const files = useKanbanStore((s) => s.files)
  const addFiles = useKanbanStore((s) => s.addFiles)
  const [question, setQuestion] = useState<Question | null>(null)
  const answer = useRef<((decision: Decision) => void) | null>(null)

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

  const runImport = async ({ staged }: { staged: StagedFile[] }): Promise<StoredFile[]> => {
    const scopeNames = files
      .filter((f) => (scopeProjectId ? f.projectId === scopeProjectId : !f.projectId))
      .map((f) => f.name)
    const { direct, duplicates } = planImport(staged, scopeNames)
    const taken = [...scopeNames, ...direct.map((item) => item.name)]
    const toImport: ImportItem[] = [...direct]
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
        toImport.push({ token: duplicate.token, name })
      } else toDiscard.push(duplicate.token)
    }

    if (toDiscard.length) await window.electronAPI.files.discard(toDiscard)
    if (!toImport.length) return []
    const imported = await window.electronAPI.files.import(toImport)
    const stored: StoredFile[] = scopeProjectId
      ? imported.map((file) => ({ ...file, projectId: scopeProjectId }))
      : imported
    if (stored.length) addFiles(stored)
    return stored
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
