import { useKanbanStore } from '../../store/kanban'
import type { StoredFile } from '../../types'
import { formatDateBR } from '../../utils/dates'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const EXT_GROUPS: Record<string, string[]> = {
  pdf:    ['.pdf'],
  word:   ['.doc', '.docx', '.odt', '.rtf'],
  excel:  ['.xls', '.xlsx', '.ods', '.csv'],
  ppt:    ['.ppt', '.pptx', '.odp'],
  image:  ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'],
  text:   ['.txt', '.md', '.json', '.xml', '.yaml', '.yml'],
}

function fileGroup(ext: string): keyof typeof EXT_GROUPS | 'other' {
  const e = ext.toLowerCase()
  for (const [group, exts] of Object.entries(EXT_GROUPS)) {
    if (exts.includes(e)) return group as keyof typeof EXT_GROUPS
  }
  return 'other'
}

function FileIcon({ ext }: { ext: string }) {
  const group = fileGroup(ext)
  const colors: Record<string, string> = {
    pdf:   '#ec6a6a',
    word:  '#a080f0',
    excel: '#46d478',
    ppt:   '#f08a34',
    image: '#a080f0',
    text:  '#999999',
    other: '#999999',
  }
  const color = colors[group]

  if (group === 'image') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    )
  }

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {group === 'pdf'   && <text x="6" y="18" fontSize="5" fill={color} stroke="none" fontWeight="bold">PDF</text>}
      {group === 'excel' && <polyline points="8 13 10 17 12 13 14 17 16 13" stroke={color} strokeWidth="1.2" fill="none" />}
      {group === 'word'  && <><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="16" x2="14" y2="16" /></>}
      {group === 'ppt'   && <rect x="8" y="12" width="8" height="6" rx="1" />}
    </svg>
  )
}

function ActionBtn({
  title,
  onClick,
  children,
  danger,
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors opacity-0 group-hover:opacity-100 ${
        danger
          ? 'text-[#999999] hover:text-[#e04040] hover:bg-[#e04040]/10'
          : 'text-[#999999] hover:text-[#a080f0] hover:bg-[#7c3aed]/10'
      }`}
    >
      {children}
    </button>
  )
}

function FileRow({
  file,
  onOpen,
  onOpenInBrowser,
  onDownload,
  onDelete,
}: {
  file: StoredFile
  onOpen: () => void
  onOpenInBrowser: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-[#232323] border border-[#3b3b3b] hover:border-[#555555] transition-colors">
      <div className="shrink-0">
        <FileIcon ext={file.ext} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#d4d4d4] truncate">{file.name}</p>
        <p className="text-[11px] text-[#666666] mt-0.5">
          {formatSize(file.size)} · {formatDateBR(file.createdAt)}
        </p>
      </div>

      <span className="text-[10px] text-[#666666] font-mono shrink-0 uppercase group-hover:hidden">
        {file.ext.replace('.', '')}
      </span>

      {/* Actions — visible on hover */}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <ActionBtn title="Abrir com programa" onClick={onOpen}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Abrir
        </ActionBtn>

        <ActionBtn title="Abrir no navegador" onClick={onOpenInBrowser}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Navegador
        </ActionBtn>

        <ActionBtn title="Baixar cópia" onClick={onDownload}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Baixar
        </ActionBtn>

        <div className="w-px h-4 bg-[#3b3b3b] mx-1" />

        <ActionBtn title="Remover arquivo" onClick={onDelete} danger>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </ActionBtn>
      </div>
    </div>
  )
}

export function FilesView({ activeProjectId }: { activeProjectId: string | null }) {
  const files = useKanbanStore((s) => s.files)
  const addFiles = useKanbanStore((s) => s.addFiles)
  const removeFile = useKanbanStore((s) => s.removeFile)

  const handleUpload = async () => {
    const results = await window.electronAPI.files.upload()
    if (results.length > 0) {
      addFiles(activeProjectId ? results.map((f) => ({ ...f, projectId: activeProjectId })) : results)
    }
  }

  const handleOpen = async (file: StoredFile) => {
    await window.electronAPI.files.open(file.id, file.ext)
  }

  const handleOpenInBrowser = async (file: StoredFile) => {
    await window.electronAPI.files.openInBrowser(file.id, file.ext)
  }

  const handleDownload = async (file: StoredFile) => {
    await window.electronAPI.files.download(file.id, file.name, file.ext)
  }

  const handleDelete = async (file: StoredFile) => {
    await window.electronAPI.files.delete(file.id, file.ext)
    removeFile(file.id)
  }

  const visible = activeProjectId
    ? files.filter((f) => f.projectId === activeProjectId)
    : files.filter((f) => !f.projectId)

  const sorted = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#3b3b3b] shrink-0">
        <span className="text-xs text-[#999999]">
          {sorted.length} {sorted.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
        <button
          onClick={handleUpload}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#7c3aed]/15 text-[#a080f0] text-xs font-medium hover:bg-[#7c3aed]/25 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Adicionar arquivos
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#d4d4d4] font-medium mb-1">Nenhum arquivo neste projeto</p>
              <p className="text-sm text-[#999999]">Adicione docs, planilhas e outros arquivos para acesso rápido</p>
            </div>
            <button
              onClick={handleUpload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[#7c3aed]/40 text-[#a080f0] text-sm hover:border-[#7c3aed] hover:bg-[#7c3aed]/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Adicionar arquivos
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sorted.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onOpen={() => handleOpen(file)}
                onOpenInBrowser={() => handleOpenInBrowser(file)}
                onDownload={() => handleDownload(file)}
                onDelete={() => handleDelete(file)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
