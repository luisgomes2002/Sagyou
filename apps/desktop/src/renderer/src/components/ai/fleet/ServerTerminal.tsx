import { useCallback } from 'react'
import { InteractiveTerminal } from '../AgentTerminal'
import {
  SERVER_FIRST_RUN_HINT,
  SERVER_STATE_TEXT,
  serverSessionKey,
  type RcServerView
} from '../../../utils/rcServers'

/** A Remote Control server's tab in the Fleet: only its terminal and Desligar
 * (no diff, inspector or delivery). Closing the tab never ends the server. */
export function ServerTerminal({
  server,
  stopping,
  error,
  onStop
}: {
  server: RcServerView
  stopping: boolean
  error: string | null
  onStop: (projectId: string) => void
}): React.JSX.Element {
  const id = serverSessionKey(server.projectId)
  const onInput = useCallback(
    async (data: string): Promise<void> => {
      await window.electronAPI.rcServers.terminalInput(id, data)
    },
    [id]
  )
  const onResize = useCallback(
    async (cols: number, rows: number): Promise<void> => {
      await window.electronAPI.rcServers.terminalResize(id, cols, rows)
    },
    [id]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-w-0 items-center gap-3 px-6 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-[#d4d4d4]">Servidor: {server.name}</h2>
          <p className="text-xs text-[#999999]">{SERVER_STATE_TEXT[server.state]}</p>
        </div>
        <button
          type="button"
          disabled={stopping}
          onClick={() => onStop(server.projectId)}
          className="shrink-0 rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50"
        >
          Desligar
        </button>
      </header>
      {server.state === 'needs-confirm' && (
        <p className="px-6 pb-2 text-xs text-[#d9a640]">{SERVER_FIRST_RUN_HINT}</p>
      )}
      {error && (
        <p role="alert" className="px-6 pb-2 text-xs text-[#ec6a6a]">
          {error}
        </p>
      )}
      <InteractiveTerminal
        log=""
        running
        runId={id}
        onInput={onInput}
        onResize={onResize}
        ariaLabel={`Terminal do servidor ${server.name}`}
      />
    </div>
  )
}
