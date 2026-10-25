import { useEffect, useState } from 'react'
import { ALL_FEATURE_IDS, type FeatureId } from '../../types'
import { ModalBase } from '../ModalBase'

const FEATURES: { id: FeatureId; title: string; description: string }[] = [
  {
    id: 'kanban',
    title: 'Kanban',
    description: 'Projetos, quadro, próximas tarefas e concluídas.'
  },
  { id: 'habits', title: 'Hábitos', description: 'Acompanhe rotinas e consistência diária.' },
  { id: 'goals', title: 'Metas', description: 'Defina objetivos e registre seu progresso.' },
  {
    id: 'financial',
    title: 'Finanças',
    description: 'Organize contas, lançamentos e objetivos financeiros.'
  },
  { id: 'planning', title: 'Planejamento', description: 'Planeje blocos de tempo e rotinas.' },
  { id: 'reports', title: 'Relatórios', description: 'Veja resumos do seu trabalho.' },
  { id: 'canvas', title: 'Canvas', description: 'Organize ideias visualmente.' },
  { id: 'files', title: 'Arquivos', description: 'Guarde referências em uma biblioteca local.' },
  { id: 'graph', title: 'Grafo', description: 'Explore conexões entre projetos e itens.' },
  { id: 'ai', title: 'IA', description: 'Converse com o assistente e agentes.' }
]

interface Props {
  open: boolean
  initialFeatures?: FeatureId[]
  onSave: (features: FeatureId[]) => void
  onClose?: () => void
}

export function FeatureOnboarding({ open, initialFeatures, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<FeatureId[]>(initialFeatures ?? ALL_FEATURE_IDS)

  useEffect(() => {
    if (open) setSelected(initialFeatures ?? ALL_FEATURE_IDS)
  }, [open, initialFeatures])

  const toggle = (feature: FeatureId) => {
    setSelected((current) =>
      current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]
    )
  }

  return (
    <ModalBase open={open} onClose={onClose ?? (() => {})}>
      <section className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-[#2b2b31] bg-[#16161a] shadow-2xl">
        <div className="px-6 pt-6 pb-4 border-b border-[#2b2b31]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#a080f0]">
            Personalize o Sagyou
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#f0f0f0]">
            Quais recursos você quer usar?
          </h2>
          <p className="mt-2 text-sm text-[#999999]">
            Você pode alterar essa escolha depois. Recursos desativados ficam fora da barra lateral,
            sem apagar nenhum dado.
          </p>
        </div>

        <div className="grid gap-2 p-5 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const active = selected.includes(feature.id)
            return (
              <button
                key={feature.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(feature.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-[#7c3aed] bg-[#30264a] text-[#f0f0f0]'
                    : 'border-[#2b2b31] bg-[#101014] text-[#999999] hover:border-[#666666]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      active ? 'border-[#a080f0] bg-[#7c3aed]' : 'border-[#666666]'
                    }`}
                  >
                    {active && <span className="text-[11px] leading-none text-white">✓</span>}
                  </span>
                  {feature.title}
                </span>
                <span className="mt-1 block pl-6 text-xs leading-relaxed text-[#999999]">
                  {feature.description}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#2b2b31] px-6 py-4">
          <button
            type="button"
            onClick={() => setSelected(ALL_FEATURE_IDS)}
            className="text-sm text-[#999999] hover:text-[#d4d4d4] transition-colors"
          >
            Selecionar tudo
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onSave(selected)}
            className="rounded-md bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continuar
          </button>
        </div>
      </section>
    </ModalBase>
  )
}
