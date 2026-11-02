import type { JSX, ReactNode } from 'react'
import type { GuideVisualId } from '../../guide/types'

const LABELS: Record<GuideVisualId, string> = {
  board: 'Exemplo: um quadro com as colunas Backlog, In Progress, Review e Done.',
  planejamento: 'Exemplo: um bloco de tempo vinculado a uma tarefa e uma rotina de pausa.',
  'meta-habito': 'Exemplo: uma meta com progresso 6 de 10 e um hábito marcado em quatro dias.',
  perfis: 'Exemplo: dois perfis financeiros, cada um com suas tabelas.',
  compras: 'Exemplo: marcar um item de compras cria uma saída; desmarcar a remove.',
  saldo: 'Exemplo: como lançamentos de hoje e futuros mudam o saldo.',
  vinculos: 'Exemplo: fatura com espelho e câmbio entre tabelas.',
  leitura: 'Exemplo: saldos separados por moeda e a equivalência só para consulta.',
  sessoes: 'Exemplo: você pede no terminal, revisa o cartão de aprovação e o registro é gravado.'
}

function Box({
  label,
  value,
  detail,
  color = 'text-[#d4d4d4]'
}: {
  label: string
  value: string
  detail?: string
  color?: string
}): JSX.Element {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-[#2b2b31] bg-[#101014] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#999999]">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${color}`}>{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-4 text-[#999999]">{detail}</p>}
    </div>
  )
}

function Arrow(): JSX.Element {
  return (
    <span aria-hidden="true" className="text-center text-lg text-[#a080f0]">
      →
    </span>
  )
}

function Flow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">{children}</div>
  )
}

function Visual({ id }: { id: GuideVisualId }): JSX.Element {
  switch (id) {
    case 'board':
      return (
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            ['Backlog', 'Ideias e tarefas'],
            ['In Progress', 'Em andamento'],
            ['Review', 'Para revisar'],
            ['Done', 'Concluída']
          ].map(([name, detail], index) => (
            <div key={name} className="rounded-lg border border-[#2b2b31] bg-[#101014] p-3">
              <p className="text-xs font-semibold text-[#d4d4d4]">{name}</p>
              <div className="mt-3 rounded border border-[#2b2b31] bg-[#16161a] px-2 py-2 text-[11px] text-[#999999]">
                {detail}
              </div>
              {index < 3 && <p className="mt-2 text-right text-xs text-[#a080f0]">→</p>}
            </div>
          ))}
        </div>
      )
    case 'planejamento':
      return (
        <div className="space-y-2">
          {[
            ['09:00', 'Bloco: trabalhar na tarefa', 'border-[#a080f0]'],
            ['11:00', 'Rotina: fazer uma pausa', 'border-[#46d478]']
          ].map(([time, text, border]) => (
            <div
              key={time}
              className="flex items-center gap-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-3"
            >
              <span className="w-16 shrink-0 text-xs text-[#999999]">{time}</span>
              <div
                className={`flex-1 rounded border-l-2 ${border} bg-[#16161a] px-3 py-2 text-xs text-[#d4d4d4]`}
              >
                {text}
              </div>
            </div>
          ))}
          <p className="text-xs text-[#999999]">
            Vincular organiza o dia; cumprir ou concluir é uma ação separada.
          </p>
        </div>
      )
    case 'meta-habito':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
            <div className="flex justify-between text-xs text-[#d4d4d4]">
              <span>Meta: ler 10 livros</span>
              <strong>6 / 10</strong>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[#2a2a30]">
              <div className="h-2 w-3/5 rounded-full bg-[#a080f0]" />
            </div>
            <p className="mt-2 text-[11px] text-[#999999]">Os registros somam o progresso.</p>
          </div>
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
            <p className="text-xs text-[#d4d4d4]">Hábito: caminhar</p>
            <div className="mt-3 flex gap-1.5">
              {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, index) => (
                <span
                  key={index}
                  className={`flex h-7 w-7 items-center justify-center rounded text-[10px] ${
                    index < 4 ? 'bg-[#20b858] text-[#0b0b0f]' : 'bg-[#2a2a30] text-[#999999]'
                  }`}
                >
                  {day}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[#999999]">
              Cada marcação representa um dia cumprido.
            </p>
          </div>
        </div>
      )
    case 'perfis':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Perfil pessoal', 'text-[#a080f0]', ['Conta corrente · BRL', 'Cartão · BRL']],
            ['Perfil trabalho', 'text-[#46d478]', ['Recebimentos · USD', 'Despesas · BRL']]
          ].map(([name, color, tables]) => (
            <div
              key={name as string}
              className="rounded-lg border border-[#2b2b31] bg-[#101014] p-4"
            >
              <p className={`text-xs font-semibold ${color as string}`}>{name as string}</p>
              <div className="mt-3 space-y-2 text-xs text-[#d4d4d4]">
                {(tables as string[]).map((table) => (
                  <p key={table} className="rounded bg-[#16161a] p-2">
                    {table}
                  </p>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-[#999999] sm:col-span-2">
            O Consolidado reúne somente as tabelas do perfil escolhido.
          </p>
        </div>
      )
    case 'compras':
      return (
        <Flow>
          <Box label="Lista de compras" value="2 × R$ 15,00" detail="Item com preço" />
          <Arrow />
          <Box
            label="Ao marcar como feito"
            value="Saída de R$ 30,00"
            detail="Lançamento vinculado em Finanças"
            color="text-[#ec6a6a]"
          />
          <Arrow />
          <Box label="Ao desmarcar" value="Saída removida" detail="O item volta à lista pendente" />
        </Flow>
      )
    case 'saldo':
      return (
        <div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Box label="1. Saldo anterior" value="R$ 500,00" detail="Ponto de partida" />
            <Box
              label="2. Lançamento de hoje"
              value="− R$ 100,00"
              detail="Uma saída diminui o saldo"
              color="text-[#ec6a6a]"
            />
            <Box
              label="3. Saldo até hoje"
              value="R$ 400,00"
              detail="500 − 100"
              color="text-[#a080f0]"
            />
          </div>
          <div className="my-3 flex items-center gap-2 text-[11px] text-[#999999]">
            <span>Saldo anterior</span>
            <span className="h-px flex-1 bg-[#2a2a30]" />
            <span className="text-[#a080f0]">Hoje</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <Box
              label="4. Lançamento futuro"
              value="− R$ 50,00"
              detail="Já cadastrado para este mês"
              color="text-[#d9a640]"
            />
            <Arrow />
            <Box
              label="5. Saldo projetado"
              value="R$ 350,00"
              detail="Inclui a saída futura"
              color="text-[#d9a640]"
            />
          </div>
        </div>
      )
    case 'vinculos':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
            <p className="text-xs font-semibold text-[#d4d4d4]">Fatura e espelho</p>
            <p className="mt-2 text-xs text-[#999999]">Fatura R$ 100,00 + espelho R$ 30,00</p>
            <p className="mt-2 text-sm font-semibold text-[#46d478]">Consolidado: R$ 100,00</p>
            <p className="mt-1 text-[11px] text-[#999999]">
              Com vínculo no detalhe, o espelho sai da soma.
            </p>
          </div>
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
            <p className="text-xs font-semibold text-[#d4d4d4]">Câmbio entre tabelas</p>
            <p className="mt-2 text-xs text-[#999999]">Saída em BRL → entrada em USD</p>
            <p className="mt-2 text-sm font-semibold text-[#a080f0]">Ambas as pontas permanecem</p>
            <p className="mt-1 text-[11px] text-[#999999]">
              Cada saldo continua na moeda da sua tabela.
            </p>
          </div>
        </div>
      )
    case 'leitura':
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <Box
            label="Saldo em reais"
            value="R$ 1.200,00"
            detail="Valor nativo"
            color="text-[#46d478]"
          />
          <Box
            label="Saldo em dólares"
            value="US$ 80,00"
            detail="Valor nativo"
            color="text-[#46d478]"
          />
          <Box
            label="Equivalência"
            value="Cotação do momento"
            detail="Somente para consulta; não altera lançamentos"
            color="text-[#a080f0]"
          />
        </div>
      )
    case 'sessoes':
      return (
        <Flow>
          <Box
            label="Você pede no terminal"
            value="“Crie uma tarefa…”"
            detail="Ao Codex, Claude Code ou OpenCode"
          />
          <Arrow />
          <Box
            label="O Sagyou mostra"
            value="Cartão de aprovação"
            detail="Exclusões e dinheiro sempre pedem aprovação"
            color="text-[#d9a640]"
          />
          <Arrow />
          <Box label="Depois de aprovar" value="Registro gravado" color="text-[#46d478]" />
        </Flow>
      )
  }
}

export function GuideVisual({ id }: { id: GuideVisualId }): JSX.Element {
  return (
    <figure
      role="img"
      aria-label={LABELS[id]}
      className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-4"
    >
      <Visual id={id} />
    </figure>
  )
}

export const GUIDE_VISUAL_IDS = Object.keys(LABELS) as GuideVisualId[]
