import { useState } from 'react'
import type { Currency, FinancialTable, FinancialTransaction } from '../../types'
import { useKanbanStore } from '../../store/kanban'
import { D, formatCurrency, formatDateBR, parseDecimalInput } from './shared'

interface Props {
  transaction: FinancialTransaction
  currency: Currency
  allLists: FinancialTable[]
  onUpdate: (updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
}

const FIELD_NAMES: Record<string, string> = {
  description: 'Descrição',
  amount: 'Valor',
  date: 'Data',
  category: 'Categoria',
  source: 'Origem',
  bankReference: 'ID bancário/Pix',
  counterparty: 'Contraparte',
  receiptFileIds: 'Comprovantes',
  reconciledAt: 'Conferência',
  currencyTransferId: 'Vínculo de câmbio',
  currencyTransferFee: 'Tarifa',
  currencyTransferFeeCurrency: 'Moeda da tarifa',
  details: 'Detalhes'
}

function auditChangeLabel(
  change: { field: string; before?: unknown; after?: unknown },
  allLists: FinancialTable[],
  transactionId: string
): string {
  const name = FIELD_NAMES[change.field] ?? change.field
  if (change.field === 'currencyTransferId') {
    const groupId = typeof change.after === 'string' ? change.after : change.before
    const pair = allLists.flatMap((list) =>
      list.transactions
        .filter(
          (tx) =>
            tx.id !== transactionId &&
            (tx.currencyTransferId === groupId ||
              tx.audit?.some((entry) =>
                entry.changes.some(
                  (item) => item.field === 'currencyTransferId' && item.after === groupId
                )
              ))
        )
        .map((tx) => `${tx.description} (${list.name})`)
    )[0]
    return `${name}: ${change.after ? 'vinculado' : 'desvinculado'}${pair ? ` a ${pair}` : ''}`
  }
  if (Array.isArray(change.before) || Array.isArray(change.after)) return `${name} alterados`
  const before = change.before == null || change.before === '' ? 'vazio' : String(change.before)
  const after = change.after == null || change.after === '' ? 'vazio' : String(change.after)
  return `${name}: ${before} → ${after}`
}

export function TransactionRecordPanel({
  transaction,
  currency,
  allLists,
  onUpdate
}: Props): React.JSX.Element {
  const files = useKanbanStore((state) => state.files)
  const addFiles = useKanbanStore((state) => state.addFiles)
  const linkCurrencyTransfer = useKanbanStore((state) => state.linkCurrencyTransfer)
  const unlinkCurrencyTransfer = useKanbanStore((state) => state.unlinkCurrencyTransfer)
  const setCurrencyTransferFee = useKanbanStore((state) => state.setCurrencyTransferFee)
  const [source, setSource] = useState(transaction.source ?? '')
  const [counterparty, setCounterparty] = useState(transaction.counterparty ?? '')
  const [bankReference, setBankReference] = useState(transaction.bankReference ?? '')
  const [savedBankDetails, setSavedBankDetails] = useState({
    source: transaction.source ?? '',
    counterparty: transaction.counterparty ?? '',
    bankReference: transaction.bankReference ?? ''
  })
  const [saveStatus, setSaveStatus] = useState<'editing' | 'saved' | null>(null)
  const [selectedPair, setSelectedPair] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [feeDraft, setFeeDraft] = useState(transaction.currencyTransferFee ?? '')

  const currentList = allLists.find((list) =>
    list.transactions.some((tx) => tx.id === transaction.id)
  )
  const partner = (() => {
    if (!transaction.currencyTransferId) return null
    for (const list of allLists) {
      const tx = list.transactions.find(
        (item) =>
          item.id !== transaction.id && item.currencyTransferId === transaction.currencyTransferId
      )
      if (tx) return { tx, list }
    }
    return null
  })()

  const candidates = allLists.flatMap((list) =>
    list.id === currentList?.id || list.currency === currency
      ? []
      : list.transactions
          .filter(
            (tx) =>
              tx.type !== transaction.type &&
              !tx.currencyTransferId &&
              !tx.linkedTransactionId &&
              !tx.fromShopping &&
              !transaction.linkedTransactionId &&
              !transaction.fromShopping
          )
          .map((tx) => ({ tx, list }))
  )
  const outgoing = transaction.type === 'expense' ? { tx: transaction, list: currentList } : partner
  const incoming = transaction.type === 'income' ? { tx: transaction, list: currentList } : partner
  const [feeCurrencyDraft, setFeeCurrencyDraft] = useState<Currency>(
    transaction.currencyTransferFeeCurrency ?? outgoing?.list?.currency ?? currency
  )
  const rate =
    outgoing?.list && incoming?.list && D(outgoing.tx.amount).greaterThan(0)
      ? D(incoming.tx.amount).div(outgoing.tx.amount).toDecimalPlaces(6).toString()
      : null
  const bankDetailsChanged =
    source.trim() !== savedBankDetails.source ||
    counterparty.trim() !== savedBankDetails.counterparty ||
    bankReference.trim() !== savedBankDetails.bankReference
  const saveBankDetails = (): void => {
    const updates: Partial<
      Pick<FinancialTransaction, 'source' | 'counterparty' | 'bankReference'>
    > = {}
    const values = {
      source: source.trim(),
      counterparty: counterparty.trim(),
      bankReference: bankReference.trim()
    }
    for (const field of ['source', 'counterparty', 'bankReference'] as const) {
      if (values[field] !== savedBankDetails[field]) updates[field] = values[field] || undefined
    }
    if (!Object.keys(updates).length) return
    onUpdate(updates)
    setSource(values.source)
    setCounterparty(values.counterparty)
    setBankReference(values.bankReference)
    setSavedBankDetails(values)
    setSaveStatus('saved')
  }

  const attach = async (): Promise<void> => {
    const uploaded = await window.electronAPI.files.upload()
    if (!uploaded?.length) return
    addFiles(uploaded)
    onUpdate({
      receiptFileIds: [
        ...new Set([...(transaction.receiptFileIds ?? []), ...uploaded.map((file) => file.id)])
      ]
    })
  }

  const link = (): void => {
    if (!currentList || !selectedPair) return
    const candidate = candidates.find((item) => item.tx.id === selectedPair)
    if (!candidate) return
    const from =
      transaction.type === 'expense'
        ? { listId: currentList.id, txId: transaction.id }
        : { listId: candidate.list.id, txId: candidate.tx.id }
    const to =
      transaction.type === 'income'
        ? { listId: currentList.id, txId: transaction.id }
        : { listId: candidate.list.id, txId: candidate.tx.id }
    if (linkCurrencyTransfer(from.listId, from.txId, to.listId, to.txId)) setSelectedPair('')
  }

  const saveFee = (): void => {
    if (!transaction.currencyTransferId) return
    const fee = feeDraft.trim() ? parseDecimalInput(feeDraft, feeCurrencyDraft) : null
    if (feeDraft.trim() && (!fee || fee.isNegative())) {
      setFeeDraft(transaction.currencyTransferFee ?? '')
      return
    }
    setCurrencyTransferFee(
      transaction.currencyTransferId,
      fee?.toString(),
      fee ? feeCurrencyDraft : undefined
    )
  }

  return (
    <div className="ml-5 rounded-lg border border-[#2b2b31] bg-[#16161a] p-3 text-xs text-[#d4d4d4] space-y-3">
      <div className="flex items-center gap-3">
        <p className="font-semibold">Documentação e conferência</p>
        <span
          role="status"
          className={saveStatus === 'saved' ? 'text-[#46d478]' : 'text-[#999999]'}
        >
          {bankDetailsChanged
            ? 'Alterações não salvas'
            : saveStatus === 'saved'
              ? '✓ Informações salvas'
              : ''}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[#999999]">Banco ou app de origem</span>
          <input
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setSaveStatus('editing')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                saveBankDetails()
              }
            }}
            placeholder="Ex.: Wise"
            className="w-full rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5 outline-none focus:border-[#7c3aed]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[#999999]">
            {transaction.type === 'expense' ? 'Quem recebeu' : 'Quem pagou'}
          </span>
          <input
            value={counterparty}
            onChange={(e) => {
              setCounterparty(e.target.value)
              setSaveStatus('editing')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                saveBankDetails()
              }
            }}
            placeholder={
              transaction.type === 'expense' ? 'Nome de quem recebeu' : 'Nome de quem pagou'
            }
            className="w-full rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5 outline-none focus:border-[#7c3aed]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[#999999]">ID bancário/Pix</span>
          <input
            value={bankReference}
            onChange={(e) => {
              setBankReference(e.target.value)
              setSaveStatus('editing')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                saveBankDetails()
              }
            }}
            placeholder="Referência no extrato"
            className="w-full rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5 outline-none focus:border-[#7c3aed]"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={saveBankDetails}
          disabled={!bankDetailsChanged}
          className="rounded bg-[#2a2a30] px-3 py-1.5 font-medium text-[#d4d4d4] hover:bg-[#303036] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar informações
        </button>
      </div>
      <div className="border-t border-[#2b2b31] pt-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">Comprovantes</span>
          <button
            type="button"
            onClick={attach}
            className="rounded bg-[#16161a] px-2 py-1 text-[#a080f0] hover:bg-[#2a2a30]"
          >
            + Anexar arquivo
          </button>
        </div>
        {files.some((file) => !transaction.receiptFileIds?.includes(file.id)) && (
          <div className="mt-2 flex gap-2">
            <select
              aria-label="Arquivo existente"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="min-w-0 flex-1 rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5"
            >
              <option value="">Ou escolha um arquivo já salvo</option>
              {files
                .filter((file) => !transaction.receiptFileIds?.includes(file.id))
                .map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!selectedFile}
              onClick={() => {
                onUpdate({ receiptFileIds: [...(transaction.receiptFileIds ?? []), selectedFile] })
                setSelectedFile('')
              }}
              className="rounded bg-[#16161a] px-2 py-1 text-[#a080f0] disabled:opacity-50"
            >
              Vincular
            </button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {(transaction.receiptFileIds ?? []).map((id) => {
            const file = files.find((item) => item.id === id)
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded border border-[#2b2b31] px-2 py-1"
              >
                {file ? (
                  <button
                    type="button"
                    onClick={() => window.electronAPI.files.open(file.id, file.ext)}
                    className="text-[#a080f0] hover:text-white"
                  >
                    {file.name}
                  </button>
                ) : (
                  <span className="text-[#e8b810]">Arquivo não encontrado</span>
                )}
                <button
                  type="button"
                  aria-label={`Desvincular ${file?.name ?? 'arquivo'}`}
                  onClick={() =>
                    onUpdate({
                      receiptFileIds: (transaction.receiptFileIds ?? []).filter(
                        (item) => item !== id
                      )
                    })
                  }
                  className="text-[#999999] hover:text-[#e04040]"
                >
                  ×
                </button>
              </span>
            )
          })}
          {!transaction.receiptFileIds?.length && (
            <span className="text-[#999999]">Nenhum comprovante ligado.</span>
          )}
        </div>
      </div>
      <div className="border-t border-[#2b2b31] pt-3 space-y-2">
        <p className="font-medium">Transferência entre moedas</p>
        {transaction.currencyTransferId ? (
          <>
            <p className="text-[#999999]">
              {partner
                ? `${outgoing?.list?.name}: ${formatCurrency(outgoing?.tx.amount ?? '0', outgoing?.list?.currency ?? currency)} → ${incoming?.list?.name}: ${formatCurrency(incoming?.tx.amount ?? '0', incoming?.list?.currency ?? currency)}`
                : 'A outra ponta desta transferência não foi encontrada.'}
            </p>
            {rate && (
              <p>
                Taxa efetiva: 1 {outgoing?.list?.currency} = {rate} {incoming?.list?.currency}
              </p>
            )}
            <div className="flex items-center gap-2">
              <label className="text-[#999999]">Tarifa informativa</label>
              <input
                value={feeDraft}
                onChange={(e) => setFeeDraft(e.target.value)}
                onBlur={saveFee}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder="0"
                className="w-24 rounded border border-[#2b2b31] bg-[#101014] px-2 py-1 outline-none focus:border-[#7c3aed]"
              />
              <select
                aria-label="Moeda da tarifa"
                value={feeCurrencyDraft}
                onChange={(e) => {
                  const next = e.target.value as Currency
                  setFeeCurrencyDraft(next)
                  if (transaction.currencyTransferId && transaction.currencyTransferFee)
                    setCurrencyTransferFee(
                      transaction.currencyTransferId,
                      transaction.currencyTransferFee,
                      next
                    )
                }}
                className="rounded border border-[#2b2b31] bg-[#101014] px-2 py-1"
              >
                {[
                  ...new Set([outgoing?.list?.currency, incoming?.list?.currency].filter(Boolean))
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => unlinkCurrencyTransfer(transaction.currencyTransferId!)}
                className="ml-auto text-[#e04040] hover:text-white"
              >
                Desvincular par
              </button>
            </div>
            <p className="text-[#999999]">
              A tarifa não entra nos totais; lance-a como despesa se foi cobrada separadamente.
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Outra ponta da transferência"
              value={selectedPair}
              onChange={(e) => setSelectedPair(e.target.value)}
              className="min-w-0 flex-1 rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5"
            >
              <option value="">
                Selecione a {transaction.type === 'expense' ? 'entrada' : 'saída'} em outra moeda
              </option>
              {candidates.map(({ tx, list }) => (
                <option key={tx.id} value={tx.id}>
                  {list.name} · {formatDateBR(tx.date)} · {tx.description} ·{' '}
                  {formatCurrency(tx.amount, list.currency)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedPair}
              onClick={link}
              className="rounded bg-[#16161a] px-3 py-1.5 text-[#a080f0] disabled:opacity-50"
            >
              Vincular
            </button>
          </div>
        )}
      </div>
      <div className="border-t border-[#2b2b31] pt-3 flex flex-wrap items-center gap-3">
        {transaction.reconciledAt && (
          <span className="text-[#46d478]">
            ✓ Conferido com extrato em {new Date(transaction.reconciledAt).toLocaleString('pt-BR')}
          </span>
        )}
        <span className="text-[#999999]">
          Criado:{' '}
          {transaction.createdAt
            ? new Date(transaction.createdAt).toLocaleString('pt-BR')
            : 'data não registrada'}
        </span>
        {transaction.updatedAt && (
          <span className="text-[#999999]">
            Alterado: {new Date(transaction.updatedAt).toLocaleString('pt-BR')}
          </span>
        )}
      </div>
      {!!transaction.audit?.length && (
        <details className="border-t border-[#2b2b31] pt-3">
          <summary className="cursor-pointer text-[#a080f0]">
            Histórico de alterações ({transaction.audit.length})
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[#999999]">
            {[...transaction.audit].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                {new Date(entry.at).toLocaleString('pt-BR')} ·{' '}
                {entry.changes
                  .map((change) => auditChangeLabel(change, allLists, transaction.id))
                  .join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
