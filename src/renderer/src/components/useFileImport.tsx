import { useRef, useState } from 'react'
import { useKanbanStore } from '../store/kanban'
import type { StoredFile } from '../types'
import { planImport, uniqueCopyName, type ImportItem, type StagedFile } from '../utils/file-duplicates'
import { ModalBase } from './ModalBase'
import { CancelButton } from './CancelButton'

interface Decision {
  copy: boolean
  applyToRest: boolean
}

interface Question {
  name: string
  remaining: number
}

function DuplicateFileDialog({
  question,
  inProject,
  onDecide
}: {
  question: Question
  inProject: boolean
  onDecide: (decision: Decision) => void
}) {
  const [applyToRest, setApplyToRest] = useState(false)
  const where = inProject ? 'neste projeto' : 'nos arquivos gerais'

  return (
    <ModalBase open onClose={() => onDecide({ copy: false, applyToRest })}>
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#2b2b31] bg-[#16161a] shadow-2xl p-6">
        <h3 className="text-base font-semibold text-[#d4d4d4] mb-2">Arquivo já existe</h3>
        <p className="text-sm text-[#999999] mb-4 leading-relaxed">
          {`“${question.name}” já está ${where}. Quer salvar outra cópia?`}
        </p>
        {question.remaining > 0 && (
          <label className="flex items-center gap-2 mb-5 text-xs text-[#999999]">
            <input
              type="checkbox"
              checked={applyToRest}
              onChange={(event) => setApplyToRest(event.target.checked)}
              className="h-3.5 w-3.5 accent-[#6d5bb8]"
            />
            {`Aplicar aos próximos (${question.remaining})`}
          </label>
        )}
        <div className="flex justify-end gap-3">
          <CancelButton onClick={() => onDecide({ copy: false, applyToRest })}>Pular</CancelButton>
          <button
            type="button"
            onClick={() => onDecide({ copy: true, applyToRest })}
            className="px-4 py-2 text-sm rounded-lg bg-[#6d5bb8] text-white hover:bg-[#7b69c6] transition-colors font-medium"
          >
            Salvar cópia
          </button>
        </div>
      </div>
    </ModalBase>
  )
}

/**
 * Settles staged files (from files.pick or files.stageDropped) into the scope
 * a screen shows: a project's files, or the general ones when `scopeProjectId`
 * is null. Names already in that scope are asked about one by one; every
 * staged token is either imported or discarded.
 */
export function useFileImport(scopeProjectId: string | null) {
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
