import { useState } from 'react'
import { ModalBase } from './ModalBase'
import { CancelButton } from './CancelButton'

export interface Decision {
  copy: boolean
  applyToRest: boolean
}

export interface Question {
  name: string
  remaining: number
}

export function DuplicateFileDialog({
  question,
  inProject,
  onDecide
}: {
  question: Question
  inProject: boolean
  onDecide: (decision: Decision) => void
}): React.JSX.Element {
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
