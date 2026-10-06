import type { FinancialTable, StoredFile } from '../../types'
import { formatDateBR } from '../../utils/dates'

interface Props {
  lists: FinancialTable[]
  files: StoredFile[]
}

export function ReceiptsTab({ lists, files }: Props): React.JSX.Element {
  const fileById = new Map(files.map((file) => [file.id, file]))
  const receipts = lists
    .flatMap((list) =>
      list.transactions.flatMap((transaction) =>
        (transaction.receiptFileIds ?? []).map((fileId) => ({
          fileId,
          file: fileById.get(fileId),
          transaction,
          list
        }))
      )
    )
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date))

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 text-[#d4d4d4]">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Comprovantes financeiros</h3>
        <p className="mt-1 text-xs text-[#999999]">
          Arquivos vinculados aos lançamentos deste perfil, em todas as tabelas e meses.
        </p>
      </div>
      {receipts.length === 0 ? (
        <div className="rounded-lg border border-[#3b3b3b] bg-[#232323] p-5 text-sm text-[#999999]">
          Nenhum comprovante vinculado. Abra um lançamento em Finanças e clique em Documentar para
          anexar um arquivo.
        </div>
      ) : (
        <div className="space-y-2">
          {receipts.map(({ fileId, file, transaction, list }) => (
            <div
              key={`${list.id}:${transaction.id}:${fileId}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[#3b3b3b] bg-[#232323] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {file?.name ?? 'Arquivo não encontrado'}
                </p>
                <p className="mt-1 text-xs text-[#999999]">
                  {list.name} · {formatDateBR(transaction.date)} · {transaction.description}
                </p>
              </div>
              {file && (
                <button
                  type="button"
                  onClick={() => window.electronAPI.files.open(file.id, file.ext)}
                  className="rounded border border-[#3b3b3b] px-3 py-1.5 text-xs text-[#a080f0] hover:border-[#7c3aed] hover:text-white"
                >
                  Abrir
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
