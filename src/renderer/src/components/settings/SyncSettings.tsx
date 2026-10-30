import { useEffect, useState, type JSX } from 'react'
import QRCode from 'qrcode'

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void
}

interface Device {
  id: string
  name: string
  current: boolean
  revokedAt: number | null
}

export function SyncSettings({ onToast }: Props): JSX.Element {
  const [active, setActive] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [busy, setBusy] = useState(false)
  const [uri, setUri] = useState('')
  const [qr, setQr] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [target, setTarget] = useState<Device | null>(null)
  const [wipe, setWipe] = useState(false)
  const [factor, setFactor] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    void window.electronAPI.sync.status().then(async (status) => {
      if (!mounted || status.state === 'off' || status.state === 'no-keychain') return
      setActive(true)
      const result = await window.electronAPI.sync.devices()
      if (mounted && result.ok) setDevices(result.devices)
    })
    return () => {
      mounted = false
    }
  }, [])

  const enroll = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.electronAPI.sync.enrollTotp()
      if (!result.ok) throw new Error(result.error)
      const parsed = new URL(result.uri)
      if (parsed.protocol !== 'otpauth:' || !parsed.searchParams.get('secret'))
        throw new Error('Resposta inválida do servidor.')
      setUri(result.uri)
      setQr(await QRCode.toDataURL(result.uri, { margin: 2, width: 192 }))
      setBackupCodes([])
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível cadastrar o autenticador.'
      )
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.electronAPI.sync.confirmTotp(confirmCode)
      if (!result.ok) throw new Error(result.error)
      setBackupCodes(result.backupCodes)
      setUri('')
      setQr('')
      setConfirmCode('')
      onToast('Autenticador confirmado.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Código inválido.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (): Promise<void> => {
    if (!target || (wipe && !factor.trim())) return
    setBusy(true)
    setError('')
    try {
      const result = await window.electronAPI.sync.revoke(
        target.id,
        wipe,
        wipe ? { totp: factor.trim() } : undefined
      )
      if (!result.ok) throw new Error(result.error)
      setDevices((current) => current.filter((device) => device.id !== target.id))
      setTarget(null)
      setFactor('')
      setWipe(false)
      onToast('Aparelho revogado.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível revogar o aparelho.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-[#d4d4d4]">Sincronização</h2>
        <p className="mt-1 text-xs text-[#999999]">
          Proteja a recuperação e o apagamento remoto dos aparelhos.
        </p>
      </div>
      {!active && (
        <p className="text-sm text-[#999999]">
          Ative a sincronização para cadastrar o autenticador.
        </p>
      )}
      {active && (
        <>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[#d4d4d4]">Google Authenticator</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => void enroll()}
              className="rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50"
            >
              Cadastrar ou trocar autenticador
            </button>
            {uri && (
              <div className="space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
                {qr && (
                  <img src={qr} alt="QR para cadastrar o autenticador" className="h-48 w-48" />
                )}
                <p className="break-all text-xs text-[#999999]">
                  {new URL(uri).searchParams.get('secret')}
                </p>
                <label className="block text-sm text-[#d4d4d4]">
                  Código de confirmação
                  <input
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(event.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                    className="mt-1 block w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-[#d4d4d4]"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !/^\d{6}$/.test(confirmCode)}
                  onClick={() => void confirm()}
                  className="rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50"
                >
                  Confirmar código
                </button>
              </div>
            )}
            {backupCodes.length > 0 && (
              <div className="space-y-2 rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
                <p className="text-sm text-[#d9a640]">
                  Guarde estes códigos reserva. Cada um funciona uma vez.
                </p>
                <p className="break-all font-mono text-xs text-[#d4d4d4]">
                  {backupCodes.join(' · ')}
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-[#d4d4d4]">Aparelhos</h3>
            {devices
              .filter((device) => !device.current && device.revokedAt === null)
              .map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-3"
                >
                  <span className="min-w-0 truncate text-sm text-[#d4d4d4]">{device.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTarget(device)
                      setWipe(false)
                      setFactor('')
                      setError('')
                    }}
                    className="rounded-lg bg-[#2a2a30] px-3 py-1.5 text-sm text-[#ec6a6a] hover:bg-[#303036]"
                  >
                    Revogar {device.name}
                  </button>
                </div>
              ))}
            {target && (
              <div className="space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4">
                <p className="text-sm text-[#d4d4d4]">Revogar {target.name}?</p>
                <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
                  <input
                    type="checkbox"
                    checked={wipe}
                    onChange={(event) => setWipe(event.target.checked)}
                  />
                  Também apagar os dados dele
                </label>
                {wipe && (
                  <>
                    <p className="text-sm text-[#d9a640]">
                      Os dados deste aparelho serão apagados sem backup; eles continuam na nuvem e
                      nos outros aparelhos.
                    </p>
                    <label className="block text-sm text-[#d4d4d4]">
                      Código do autenticador ou reserva
                      <input
                        value={factor}
                        onChange={(event) => setFactor(event.target.value)}
                        autoComplete="one-time-code"
                        className="mt-1 block w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-[#d4d4d4]"
                      />
                    </label>
                  </>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || (wipe && !factor.trim())}
                    onClick={() => void revoke()}
                    className="rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50"
                  >
                    Confirmar revogação
                  </button>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    className="rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-[#ec6a6a]">
          {error}
        </p>
      )}
    </section>
  )
}
