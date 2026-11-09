import { useState, type JSX } from 'react'
import { useRcServers } from '../../hooks/useRcServers'
import {
  SERVER_CUT_TEXT,
  SERVER_FIRST_RUN_HINT,
  SERVER_FOOTER,
  SERVER_START_FAILED,
  SERVER_STATE_TEXT,
  SERVER_STOP_FAILED,
  type RcServerState,
  type RcServerView
} from '../../utils/rcServers'

const buttonClass =
  'shrink-0 rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50'
const checkboxClass =
  'h-3.5 w-3.5 accent-[#6d5bb8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50'

const STATE_COLOR: Record<RcServerState, string> = {
  running: 'text-[#46d478]',
  stopped: 'text-[#999999]',
  starting: 'text-[#999999]',
  'needs-confirm': 'text-[#d9a640]',
  external: 'text-[#d4d4d4]'
}

/** Configurações → Controle remoto → Servidores de Remote Control (spec
 * docs/specs/2026-11-09-servidores-remote-control.md). One row per active
 * project with a code folder on this PC; main already filters the list. */
export function RcServersSection({
  onOpenServer
}: {
  onOpenServer?: (projectId: string) => void
}): JSX.Element | null {
  const { supported, servers, reload } = useRcServers()
  const [busy, setBusy] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  if (!supported) return null

  const act = async (projectId: string, action: () => Promise<string | null>): Promise<void> => {
    setBusy(projectId)
    setRowErrors((prev) => ({ ...prev, [projectId]: '' }))
    try {
      const message = await action()
      if (message) setRowErrors((prev) => ({ ...prev, [projectId]: message }))
    } finally {
      setBusy(null)
      await reload()
    }
  }

  const api = window.electronAPI.rcServers

  const configure = (
    server: RcServerView,
    patch: { enabled?: boolean; autostart?: boolean }
  ): Promise<void> =>
    act(server.projectId, async () => {
      const result = await api.configure(server.projectId, patch).catch(() => null)
      return result?.success ? null : 'Não deu para salvar, tente de novo.'
    })

  const start = (server: RcServerView): Promise<void> =>
    act(server.projectId, async () => {
      const result = await api.start(server.projectId).catch(() => null)
      if (result?.success) {
        onOpenServer?.(server.projectId)
        return null
      }
      if (result?.result === 'cut') return SERVER_CUT_TEXT
      // A missing claude comes back as the server's own error in the list.
      return SERVER_START_FAILED
    })

  const stop = (server: RcServerView): Promise<void> =>
    act(server.projectId, async () => {
      const result = await api.stop(server.projectId).catch(() => null)
      return result?.success ? null : SERVER_STOP_FAILED
    })

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-[#d4d4d4]">Servidores de Remote Control</h3>
      {servers.length === 0 ? (
        <p className="text-sm text-[#999999]">Nenhum projeto com pasta de código neste PC.</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => {
            const message = server.error ?? (rowErrors[server.projectId] || null)
            const disabled = busy !== null
            return (
              <li
                key={server.projectId}
                aria-label={server.name}
                className="space-y-2 rounded-lg border border-[#2b2b31] bg-[#16161a] px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[#d4d4d4]" title={server.name}>
                      {server.name}
                    </p>
                    <p className={`text-xs ${STATE_COLOR[server.state]}`}>
                      {SERVER_STATE_TEXT[server.state]}
                    </p>
                  </div>
                  {server.state === 'stopped' ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void start(server)}
                      className={buttonClass}
                    >
                      Ligar
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void stop(server)}
                      className={buttonClass}
                    >
                      Desligar
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <label className="flex items-center gap-2 text-xs text-[#d4d4d4]">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={disabled}
                      onChange={(event) =>
                        void configure(server, { enabled: event.target.checked })
                      }
                      className={checkboxClass}
                    />
                    Servidor de Remote Control
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[#d4d4d4]">
                    <input
                      type="checkbox"
                      checked={server.enabled && server.autostart}
                      disabled={disabled || !server.enabled}
                      onChange={(event) =>
                        void configure(server, { autostart: event.target.checked })
                      }
                      className={checkboxClass}
                    />
                    Iniciar com o Sagyou
                  </label>
                </div>
                {server.state === 'needs-confirm' && (
                  <p className="text-xs text-[#d9a640]">{SERVER_FIRST_RUN_HINT}</p>
                )}
                {message && (
                  <p role="alert" className="text-xs text-[#ec6a6a]">
                    {message}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-[#999999]">{SERVER_FOOTER}</p>
    </section>
  )
}
