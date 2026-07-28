import { useEffect, useState } from 'react'

/**
 * A copyable command (or command block), for the manual Windows/WSL steps.
 * Owns its own `copied` flash so several blocks can sit in one step without all
 * of them lighting up "Copiado" when one is clicked.
 */
function CommandBlock({
  text,
  multiline
}: {
  text: string
  multiline?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-start gap-2">
      <code
        className={`min-w-0 flex-1 rounded bg-[#1b1b1b] px-2 py-1.5 font-mono text-[11px] text-[#d4d4d4] ${
          multiline ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto whitespace-nowrap'
        }`}
      >
        {text}
      </code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="shrink-0 rounded px-2 py-1.5 text-[11px] font-medium text-[#a080f0] hover:bg-[#2a2a2a]"
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

/** The subset of ai:jail:status this dialog needs. */
export interface JailStatus {
  available: boolean
  platform: string
  installable: boolean
  wsl2?: boolean
  reason?: string
  /** `wsl --install` — shown when WSL2 is missing. */
  wslCommand: string
  /** Commands to install ai-jail inside an existing WSL2 distro. */
  wslAiJailCommands: string
}

/**
 * The kernel tweak that lets bubblewrap create the unprivileged user namespaces
 * the sandbox needs. Shown, never run: it weakens the kernel's AppArmor
 * hardening, so that call is the user's to make (mirrors main/ai-jail.ts).
 */
const APPARMOR_FIX_COMMAND = 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'

/**
 * First-run dialog for the ai-jail sandbox.
 *
 * The code agent runs shell commands with no OS confinement of its own, so the
 * sandbox is mandatory by default (see main/ai-jail.ts). This explains what it
 * is, links the project, and installs it — or, on Windows, shows the WSL2
 * command the user has to run themselves (it needs admin + a reboot, which an
 * unelevated app can't do for them).
 *
 * It renders only when the parent decides to (unavailable + not yet dismissed);
 * "Depois" leaves the agent's command tool blocked until ai-jail exists or the
 * user unticks the Sandbox box.
 */
export function SandboxOnboarding({
  status,
  onDismiss,
  onInstalled
}: {
  status: JailStatus
  onDismiss: () => void
  onInstalled: () => void
}): React.JSX.Element {
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; fraction: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isWindows = status.platform === 'win32'
  // Linux (native): ai-jail + bwrap are installed, but the kernel blocks the
  // unprivileged user namespaces bwrap needs (Ubuntu 23.10+). detectAiJail's
  // smoke test flips `available` off and puts the sysctl fix in `reason` — so
  // reinstalling won't help, and the button below is hidden in favour of the fix.
  const isAppArmorBlock =
    !isWindows &&
    !status.available &&
    /apparmor_restrict_unprivileged_userns/.test(status.reason ?? '')

  useEffect(() => {
    // Stream install progress into the bar.
    const off = window.electronAPI.ai.jail.onProgress((p) => setProgress(p))
    return off
  }, [])

  const install = async (): Promise<void> => {
    setInstalling(true)
    setError(null)
    setProgress({ phase: 'Iniciando…', fraction: null })
    try {
      const res = await window.electronAPI.ai.jail.install()
      if (res.success) {
        onInstalled()
        onDismiss()
      } else {
        setError(res.error ?? 'Falha na instalação')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na instalação')
    } finally {
      setInstalling(false)
    }
  }

  const later = async (): Promise<void> => {
    await window.electronAPI.ai.jail.dismissOnboarding()
    onDismiss()
  }

  const pct = progress?.fraction != null ? Math.round(progress.fraction * 100) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-lg rounded-xl border border-[#3b3b3b] bg-[#232323] p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-2xl" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#d4d4d4]">Proteja o agente de código</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#999999]">
              O agente de código pode executar comandos na sua máquina. O{' '}
              <span className="font-medium text-[#a080f0]">ai-jail</span> é uma camada de segurança
              que <b>isola</b> o agente — ele só lê e escreve dentro da pasta do projeto, sem acesso
              a arquivos pessoais, chaves SSH, credenciais da AWS ou configurações do sistema.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] p-3">
          <p className="text-[11px] leading-relaxed text-[#999999]">
            É <b className="text-[#d4d4d4]">obrigatório por padrão</b> para proteger você de
            comandos acidentais ou maliciosos do agente. Projeto:{' '}
            <a
              href="https://github.com/akitaonrails/ai-jail"
              target="_blank"
              rel="noreferrer"
              className="text-[#a080f0] hover:underline"
            >
              github.com/akitaonrails/ai-jail
            </a>
          </p>
        </div>

        {/* Windows, step 1: no WSL2 yet. Needs admin + reboot, so we can only
            hand over the command — the app can't run it for the user. */}
        {isWindows && !status.wsl2 && (
          <div className="mt-4 rounded-lg border border-[#7c4a2d] bg-[#1a1108] p-3">
            <p className="text-[12px] font-semibold text-[#f0a868]">Passo 1: instalar o WSL2</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#c9a68a]">
              O ai-jail roda dentro do WSL2. Abra o PowerShell <b>como administrador</b>, rode o
              comando abaixo e <b>reinicie o PC</b>. Depois reabra esta tela para o passo 2.
            </p>
            <CommandBlock text={status.wslCommand} />
          </div>
        )}

        {/* Windows, step 2: WSL2 exists, ai-jail doesn't. Install it inside WSL —
            sudo/apt is interactive, so the user runs these in the WSL terminal.
            Numbered because two things bite in practice: pasting into the wrong
            distro (docker-desktop is busybox), and forgetting that the app probes
            the DEFAULT distro (`wsl -e`), so a perfect install in Ubuntu is invisible
            until Ubuntu is the default. */}
        {isWindows && status.wsl2 && !status.available && (
          <div className="mt-4 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] p-3">
            <p className="text-[12px] font-semibold text-[#a080f0]">
              Passo 2: instalar o ai-jail dentro do WSL
            </p>

            {/* 2.1 — open the right distro */}
            <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
              <b className="text-[#a080f0]">1.</b> Abra o terminal do <b>Ubuntu</b> (menu Iniciar →
              Ubuntu).
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[#8a6a3a]">
              Nao use o distro <code className="text-[#c9a68a]">docker-desktop</code>: ele e
              mínimo (sem <code className="text-[#c9a68a]">sudo</code>/
              <code className="text-[#c9a68a]">curl</code>/<code className="text-[#c9a68a]">apt</code>)
              e os comandos falham nele com erros como “sudo: not found” ou “tar: invalid magic”.
            </p>

            {/* 2.2 — install */}
            <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
              <b className="text-[#a080f0]">2.</b> Cole e rode os comandos abaixo (instalam o
              bubblewrap e o ai-jail):
            </p>
            <CommandBlock text={status.wslAiJailCommands} multiline />

            {/* 2.3 — make Ubuntu the default so the app can detect it */}
            <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
              <b className="text-[#a080f0]">3.</b> No <b>PowerShell</b> (não no WSL), defina o Ubuntu
              como distro padrão. O app procura o sandbox no distro <b>padrão</b>, então sem isto ele
              não acha o ai-jail mesmo instalado:
            </p>
            <CommandBlock text="wsl --set-default Ubuntu" />

            {/* 2.4 — reopen */}
            <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
              <b className="text-[#a080f0]">4.</b> Feche e reabra esta tela — o sandbox passa a ficar
              ativo.
            </p>

            <p className="mt-3 text-[10.5px] leading-relaxed text-[#666666]">
              Observação: o passo de liberar namespaces do AppArmor (
              <code className="text-[#999999]">{APPARMOR_FIX_COMMAND}</code>) só vale no <b>Ubuntu
              nativo</b>. No WSL2 ele falha com “No such file or directory” — isso é <b>normal</b> e
              pode ignorar; o kernel do WSL não tem essa restrição.
            </p>
          </div>
        )}

        {/* Linux (native): ai-jail is installed but the sandbox can't start —
            the kernel restricts the user namespaces bwrap needs. Reinstalling
            won't fix it; the fix is a one-line sysctl (shown, not run). */}
        {isAppArmorBlock && (
          <div className="mt-4 rounded-lg border border-[#7c4a2d] bg-[#1a1108] p-3">
            <p className="text-[12px] font-semibold text-[#f0a868]">
              Libere os namespaces do kernel
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#c9a68a]">
              O ai-jail e o bubblewrap estão instalados, mas o kernel bloqueia os{' '}
              <i>user namespaces</i> não privilegiados que o sandbox precisa (padrão no Ubuntu
              23.10+). Rode o comando abaixo e reabra esta tela — o sandbox passa a ficar ativo.
            </p>
            <CommandBlock text={APPARMOR_FIX_COMMAND} />
            <p className="mt-2 text-[10.5px] leading-relaxed text-[#666666]">
              Isso reduz o endurecimento do kernel (AppArmor) — rode por sua conta. Como
              alternativa, crie um perfil AppArmor para o binário ou desative o Sandbox nas
              configurações (por sua conta e risco).
            </p>
          </div>
        )}

        {/* Progress while installing. */}
        {installing && (
          <div className="mt-4">
            <p className="text-[11px] text-[#999999]">{progress?.phase ?? 'Instalando…'}</p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#1b1b1b]">
              <div
                className="h-full rounded-full bg-[#4f46e5] transition-all"
                style={{ width: pct != null ? `${pct}%` : '100%', opacity: pct != null ? 1 : 0.5 }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-[11px] leading-relaxed text-[#e04040]">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={later}
            disabled={installing}
            className="rounded-md border border-[#3b3b3b] px-3.5 py-2 text-[12px] font-medium text-[#999999] hover:text-[#d4d4d4] disabled:opacity-40"
          >
            Depois
          </button>
          {/* On Windows the app can't install for the user, and in the AppArmor
              case ai-jail is already installed (the fix is the sysctl, not a
              reinstall) — so the button is hidden in both, favouring the steps. */}
          {!isWindows && !isAppArmorBlock && (
            <button
              onClick={install}
              disabled={installing || !status.installable}
              className="rounded-md bg-[#4f46e5] px-3.5 py-2 text-[12px] font-medium text-white hover:bg-[#4338ca] disabled:opacity-40"
            >
              {installing ? 'Instalando…' : 'Instalar agora'}
            </button>
          )}
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-[#666666]">
          Se escolher “Depois”, o agente de código fica bloqueado até{' '}
          {isAppArmorBlock ? 'o sandbox conseguir iniciar' : 'o ai-jail ser instalado'} — ou até
          você desativar o Sandbox nas configurações (por sua conta e risco).
        </p>
      </div>
    </div>
  )
}
