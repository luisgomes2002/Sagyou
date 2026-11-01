# Plano de implementação: Motor na bandeja

Status: approved by Luis on 2026-11-01
Spec: docs/specs/2026-11-01-motor-bandeja.md
Branch: feature/motor-bandeja

**Objetivo:** o Sagyou do PC de casa fica rodando na bandeja, inicia com o Windows,
bloqueia sozinho e continua sincronizando bloqueado.

**Arquitetura:** a lógica nova mora em módulos puros testáveis em
`apps/desktop/src/main/modules/desktop/` (preferências, menu da bandeja, gatilhos de
bloqueio, sequência de bloqueio); `index.ts` só liga esses módulos ao Electron (`Tray`,
`powerMonitor`, `setLoginItemSettings`). Bloquear é a mesma variável `passwordUnlocked`
de hoje (que já fecha todo IPC de dados) mais um aperto de mão com o renderer para
salvar antes. O renderer troca a árvore pela `UnlockScreen` sem recarregar e sem
chamar `loadData` de novo.

Caminhos relativos a `apps/desktop/` salvo indicação. Board: Sync 4.1 = Tasks 1–2;
4.2 = Task 3; 4.3 = Tasks 4–5; 4.4 = Task 6; 4.5 = Task 7.

## Restrições Globais

- Verificação de testes **pelo CI do GitHub** (preferência do Luis): cada task é
  commitada e enviada à branch do PR rascunho; não rodar `npm test` localmente.
- Arquivo de preferências: `userData/desktop-prefs.json` (`desktop-prefs-dev.json` em
  dev), gravado `.tmp` + rename, fora do SQLite, do backup e do sync.
- Padrões: `closeToTray` = `true` só em `win32`, `false` em `linux`/`darwin`;
  `idleLockMinutes` = `15`; `lockOnSystemLock` = `true`; `trayNoticeShown` = `false`.
- `idleLockMinutes` aceito: `0, 5, 15, 30, 60`; qualquer outro valor → `15`.
- Inatividade checada a cada `30_000` ms com `powerMonitor.getSystemIdleTime()`
  (segundos) ≥ `idleLockMinutes * 60`.
- Bloqueio automático só com senha ativada (`passwordConfig !== null` e não corrompida).
- Aperto de mão do bloqueio: espera do renderer `5_000` ms; depois bloqueia mesmo assim.
- Texto MCP bloqueado (exato): `O Sagyou está bloqueado. Desbloqueie no PC para continuar.`
- Aviso único da bandeja (exato): título `Sagyou`, corpo
  `O Sagyou continua rodando na bandeja. Use Sair no ícone para encerrar.`
- Argumento de login: `--hidden`.
- Novo IPC registrado **depois** de `protectDataIpc`, exceto `security:lock-ready`
  (precisa responder enquanto o main bloqueia; usa `assertTrustedRenderer`).
- Sem `console.*` no main: `log.info/warn('app', …)` com IDs/booleans apenas.
- Canal do pedido de bloqueio: **`security:lock-request`** (main→renderer); resposta
  `security:lock-ready`. (A spec dizia `security:locking`; mesmo papel, um nome só.)
- `webPreferences.backgroundThrottling: false` na janela: escondida, o renderer ainda
  serve o MCP (`store:mcp:action`), o debounce de 300 ms do `_persist` e o
  `CloseLifecycle`; com o throttling do Chromium esses timers atrasariam. (decisão do
  construtor)
- Single-instance **desligado em dev** (`is.dev`): no Windows `%APPDATA%\sagyou` (dev) e
  `%APPDATA%\Sagyou` (instalado) são a mesma pasta, e o lock impediria `npm run dev`
  com o app instalado aberto. (decisão do construtor)

## Foco de Review

1. **Desbloquear não pode recarregar os dados.** `loadData` credita o tempo de cada
   cronômetro salvo; chamá-lo de novo ao desbloquear contaria tempo em dobro e
   descartaria edições recebidas. O efeito de `App.tsx` só chama `loadData` se
   `!isLoaded`. Testado na Task 5.
2. **Sair/desligar com o app bloqueado não grava estado vazio nem dá erro.** O
   `CloseLifecycle` pula o `_flushPersist` quando bloqueado (já salvo no bloqueio) e
   conclui o fechamento. Testado na Task 5.
3. **Esconder nunca segura uma saída de verdade.** `Sair`, `update:install`
   (`allowCloseForInstall`) e fim de sessão do Windows fecham mesmo com
   `closeToTray`. Testado na Task 2.
4. **Bloqueado = nenhum dado sai pelo MCP nem entra por ele.** Leituras e escritas
   recusadas no broker; cartões pendentes negados e fila de escrita rejeitada no
   instante do bloqueio. Testado na Task 4.
5. **Mudança remota chegando com o app bloqueado e carregado** aplica só em memória,
   sem `storage.*` (que seria recusado); `store:reload` bloqueado espera o desbloqueio.
   Testado na Task 5.
6. **Dados existentes:** nada muda no SQLite/backup/sync; `desktop-prefs.json`
   ausente, ilegível ou com valores estranhos vira padrão sem quebrar a abertura.
   Testado na Task 1. O sync iniciado antes do desbloqueio aplica mudanças no banco e o
   primeiro `store:load` as lê (o renderer ignora `sync:remote-changes` enquanto
   `!isLoaded`, já é assim). Testado na Task 6.

### Task 1: Preferências do aparelho (`desktop-prefs`)

**Arquivos:** Criar `src/main/modules/desktop/desktop-prefs.ts`; Teste
`src/main/__tests__/desktop-prefs.test.ts`.
**Interfaces:** Produz
`interface DesktopPrefs { closeToTray: boolean; idleLockMinutes: 0|5|15|30|60; lockOnSystemLock: boolean; trayNoticeShown: boolean }`,
`desktopPrefsFileName(isDev: boolean): string`,
`defaultDesktopPrefs(platform: NodeJS.Platform): DesktopPrefs`,
`normalizeDesktopPrefs(raw: unknown, platform): DesktopPrefs`,
`loadDesktopPrefs(dir: string, isDev: boolean, platform): DesktopPrefs`,
`saveDesktopPrefs(dir, isDev, platform, patch: Partial<DesktopPrefs>): DesktopPrefs`
(lê, mescla, normaliza, grava e devolve).

- [ ] Passo 1: testes (`@vitest-environment node`, temp dir real):
  nome `desktop-prefs.json` / `desktop-prefs-dev.json`; padrões win32
  `{closeToTray:true, idleLockMinutes:15, lockOnSystemLock:true, trayNoticeShown:false}`
  e linux `closeToTray:false`; arquivo ausente → padrão; JSON inválido → padrão;
  `idleLockMinutes: 7` → `15`; `closeToTray: "sim"` → padrão da plataforma; save de
  `{idleLockMinutes:5}` preserva os outros campos e não deixa `.tmp` para trás; chave
  desconhecida no arquivo é descartada.
- [ ] Passo 2: commit+push. Esperado no CI: FALHA (módulo não existe).
- [ ] Passo 3: implementar (`writeFileSync(tmp)` + `renameSync`, `mkdirSync` recursivo).
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(desktop): preferências do aparelho`.

### Task 2: Bandeja, fechar = esconder, uma instância, fim de sessão

**Arquivos:** Criar `src/main/modules/desktop/tray-menu.ts`; Modificar
`src/main/handlers/window.ts`, `src/main/index.ts`; Teste
`src/main/__tests__/tray-menu.test.ts`, `src/main/__tests__/window-close.test.ts`,
`src/main/__tests__/handlers.test.ts` (mock do electron ganha `Tray`, `Menu`,
`Notification`, `powerMonitor`, `app.requestSingleInstanceLock`,
`app.getLoginItemSettings/setLoginItemSettings`).
**Interfaces:** Consome `loadDesktopPrefs`/`saveDesktopPrefs` (Task 1). Produz
`buildTrayMenu(opts: { canLock: boolean }): Array<{ id: 'open'|'lock'|'quit'|'sep'; label?: string }>`
(rótulos `Abrir Sagyou`, `Bloquear agora`, `Sair`; `lock` só se `canLock`; separador
antes de `Sair`); `CreateManagedWindowOptions` ganha
`hideOnClose?: () => boolean`, `onHidden?: () => void`, `startHidden?: boolean`;
`ManagedWindow` ganha `show(): void` (show + restore se minimizado + focus).
A saída real não tem método próprio: `index.ts` mantém `let isQuitting = false`,
ligado no **início** do `before-quit` (antes do `preventDefault` que para os timers por
até 3 s), e passa `hideOnClose: () => prefs.closeToTray && !isQuitting`. A ordem do
"Sair" fica a de hoje: `app.quit()` → `before-quit` para os timers → `app.quit()` de
novo → o Electron fecha a janela → handshake de salvamento → encerra.

- [ ] Passo 1: testes:
  - `tray-menu`: com `canLock:false` → ids `['open','sep','quit']`; com `true` →
    `['open','lock','sep','quit']`; rótulos exatos acima.
  - `window-close`: com `hideOnClose: () => true`, `close()` chama `hide`, não envia
    `app:flush-before-close`, chama `onHidden` e a janela segue viva; trocando o
    retorno de `hideOnClose` para false (saída real), `close()` envia
    `app:flush-before-close` e fecha após `completeClose`;
    `allowCloseForInstall(true)` + `close()` fecha sem esconder; `startHidden: true` não
    chama `show` no `ready-to-show`; `hideOnClose` false mantém o handshake de hoje.
  - `handlers.test`: `app.requestSingleInstanceLock` é chamado quando `is.dev` é false.
- [ ] Passo 2: commit+push. Esperado: FALHA (funções/opções inexistentes).
- [ ] Passo 3: implementar:
  - `window.ts`: no `close`, se `!allowClose && hideOnClose?.()` →
    `preventDefault`, `window.hide()`, `onHidden?.()`; senão o handshake de hoje.
    `webPreferences.backgroundThrottling: false`; `ready-to-show` só chama `show()` se
    `!startHidden`.
  - `index.ts`: antes de `whenReady`, se `!is.dev` e `!app.requestSingleInstanceLock()`
    → `app.quit()` e retorna; `app.on('second-instance', () => managedWindow?.show())`.
    `Tray` com `icon`, `setToolTip('Sagyou')`, clique e duplo clique → `show()`;
    menu de `buildTrayMenu({ canLock })` reconstruído quando o estado de bloqueio muda;
    `Sair` → `app.quit()`. `onHidden`: se `!prefs.trayNoticeShown` e
    `Notification.isSupported()`, mostra o aviso único e salva `trayNoticeShown:true`.
    `window-all-closed` continua chamando `app.quit()` fora do macOS (só acontece numa
    saída real).
    `mainWindow.on('session-end')` (Windows) → `app.quit()`. Só o `session-end`, não o
    `query-session-end`: este pode ser vetado por outro programa e o Sagyou sairia sem
    o Windows desligar. (decisão do construtor)
    `app.on('activate')` passa a chamar `managedWindow?.show()` quando a janela existe.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(desktop): bandeja e fechar esconde a janela`.

### Task 3: Iniciar com o Windows e seção "Janela e inicialização"

**Arquivos:** Modificar `src/main/index.ts`, `src/preload/index.ts`,
`src/renderer/src/components/views/SettingsView.tsx`; Criar
`src/renderer/src/components/settings/WindowSettings.tsx`; Teste
`src/main/__tests__/handlers.test.ts`,
`src/renderer/src/__tests__/components/WindowSettings.test.tsx`.
**Interfaces:** Consome Task 1 e a janela da Task 2. Produz IPC (após
`protectDataIpc`):
`desktop:prefs:get` → `DesktopPrefs & { platform: NodeJS.Platform; openAtLogin: boolean }`
(sem estado de senha: a seção "Senha" já o tem por `security.status()` e o repassa
como prop `passwordEnabled` a `AutoLockSettings`, então ativar/desativar a senha na
mesma sessão aparece na hora);
`desktop:prefs:set(patch)` → mesmo formato (aceita só `closeToTray`,
`idleLockMinutes`, `lockOnSystemLock`; demais chaves ignoradas);
`desktop:open-at-login:set(on: boolean)` → `app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })`
só em `win32` (noutros, no-op), devolve o mesmo formato. Preload:
`window.electronAPI.desktop.{ getPrefs, setPrefs, setOpenAtLogin }`. `openAtLogin` lido
de `app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin`. Janela criada com
`startHidden: process.argv.includes('--hidden')`.

- [ ] Passo 1: testes:
  - `handlers.test`: `desktop:prefs:set` com `{ trayNoticeShown: true, foo: 1, idleLockMinutes: 30 }`
    grava só `idleLockMinutes:30`; antes do desbloqueio (senha configurada) os três
    canais são recusados; `desktop:open-at-login:set(true)` em win32 chama
    `setLoginItemSettings` com `{ openAtLogin: true, args: ['--hidden'] }`.
  - `WindowSettings.test`: título `Janela e inicialização`; interruptor
    `Fechar a janela mantém o Sagyou na bandeja` com dica
    `Use Sair no ícone da bandeja para encerrar.` chama `setPrefs({ closeToTray })`;
    `Iniciar com o Windows (na bandeja)` aparece só com `platform: 'win32'` e chama
    `setOpenAtLogin`; erro de IPC mostra `Não foi possível salvar.` e volta o
    interruptor ao estado anterior.
- [ ] Passo 2: commit+push. Esperado: FALHA.
- [ ] Passo 3: implementar; `WindowSettings` segue o padrão visual de `SettingsView`
  (`section` com `SectionTitle`), inserida depois de "Aparência e acessibilidade";
  interruptores com `role="switch"` e `aria-checked` como os existentes.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(desktop): iniciar com o Windows na bandeja`.

### Task 4: Bloqueio no main (gatilhos, sequência, MCP)

**Arquivos:** Criar `src/main/modules/desktop/auto-lock.ts`,
`src/main/modules/security/app-lock.ts`; Modificar
`src/main/modules/agent/sagyou-mcp.ts`, `src/main/index.ts`; Teste
`src/main/__tests__/auto-lock.test.ts`, `src/main/__tests__/app-lock.test.ts`,
`src/main/__tests__/sagyou-mcp.test.ts`, `src/main/__tests__/handlers.test.ts`.
**Interfaces:** Consome `DesktopPrefs`. Produz:
- `type LockReason = 'idle' | 'system-lock' | 'suspend' | 'manual'` (em `app-lock.ts`).
- `createAutoLock(deps: { idleSeconds(): number; prefs(): DesktopPrefs; canLock(): boolean; lock(reason: LockReason): void; setInterval(fn, ms): unknown; clearInterval(h): void }): { start(): void; stop(): void; tick(): void; onSystemLock(): void; onSuspend(): void }`.
  `tick`: se `canLock()` e `idleLockMinutes > 0` e `idleSeconds() >= min*60` → `lock('idle')`.
  `onSystemLock`/`onSuspend`: se `canLock()` e `lockOnSystemLock` → `lock(...)`.
- `createAppLock(deps: { isUnlocked(): boolean; setUnlocked(v: boolean): void; askRenderer(): void; onLocked(reason: LockReason): void; setTimer(fn, ms): unknown; clearTimer(h): void }): { lock(reason: LockReason): void; rendererReady(): void; isLocking(): boolean }`.
  `lock(reason)`: se já bloqueado ou bloqueando, nada; senão `askRenderer()` (envia
  `security:lock-request`) e arma `5_000` ms; `rendererReady` ou o prazo →
  `setUnlocked(false)` e `onLocked(reason)` uma única vez.
- `McpBrokerDeps.isLocked?: () => boolean`; com `true`, `tools/call` responde
  `failure` com o texto exato de bloqueio sem chamar nenhum dep de leitura/escrita
  (`initialize` e `tools/list` continuam respondendo).
- `security:lock-ready` (antes de `protectDataIpc`, `assertTrustedRenderer`) →
  `appLock.rendererReady()`.
- `onLocked` no `index.ts`: para cada run em `codeRuns`, `mcpWriteQueue.rejectRun(run.id, 'O Sagyou foi bloqueado.')`
  e `resolve(false)` + `clear()` em `pendingApprovals`; reconstrói o menu da bandeja;
  `log.info('app', 'locked', { reason })`.
- Ligações: `powerMonitor.on('lock-screen', autoLock.onSystemLock)`,
  `powerMonitor.on('suspend', autoLock.onSuspend)`, `autoLock.start()` no
  `whenReady`; `canLock = () => passwordConfig !== null && !passwordConfigCorrupt && passwordUnlocked`;
  "Bloquear agora" da bandeja → `appLock.lock('manual')`.

- [ ] Passo 1: testes:
  - `auto-lock`: 15 min, idle 899 s → nada; 900 s → `lock('idle')`; `idleLockMinutes 0`
    → nunca; `canLock` false → nada; `onSystemLock` com `lockOnSystemLock:false` →
    nada; `start` agenda `30_000` ms.
  - `app-lock`: `lock` envia uma vez mesmo chamado duas vezes; `rendererReady` →
    `setUnlocked(false)` e `onLocked` uma vez; sem resposta, após `5_000` ms bloqueia
    igual; `rendererReady` depois do prazo não chama `onLocked` de novo; já bloqueado →
    `lock` não pergunta ao renderer.
  - `sagyou-mcp`: com `isLocked: () => true`, `tools/call` de `read_tasks` responde o
    texto exato e `readTasks` não é chamado; `write` não é chamado para `update_task`.
  - `handlers.test`: o mock de `powerMonitor.on` guarda os callbacks num `Map`. Com
    senha configurada: desbloquear, disparar o callback de `'lock-screen'`, conferir
    `winSent` com `security:lock-request`, invocar `security:lock-ready`; então
    `store:load` é recusado com `Desbloqueie o Sagyou para acessar os dados.`. Sem
    senha, `'lock-screen'` não envia nada.
- [ ] Passo 2: commit+push. Esperado: FALHA.
- [ ] Passo 3: implementar como acima.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(security): bloqueio automático e MCP parado quando bloqueado`.

### Task 5: Bloqueio no renderer e opções em "Senha"

**Arquivos:** Modificar também `src/renderer/src/store/kanban.ts`. Criar `src/renderer/src/services/lockState.ts`,
`src/renderer/src/hooks/useAppLock.ts`,
`src/renderer/src/components/settings/AutoLockSettings.tsx`; Modificar
`src/preload/index.ts`, `src/renderer/src/App.tsx`,
`src/renderer/src/components/layout/CloseLifecycle.tsx`,
`src/renderer/src/components/views/SettingsView.tsx`; Teste
`src/renderer/src/__tests__/hooks/useAppLock.test.tsx`,
`src/renderer/src/__tests__/components/CloseLifecycle.test.tsx`,
`src/renderer/src/__tests__/components/AutoLockSettings.test.tsx`.
**Interfaces:** Consome `security:lock-request` (main→renderer) e
`security:lock-ready` (Task 4), `desktop:prefs:*` (Task 3). Produz preload
`security.onLockRequest(cb): () => void`, `security.lockReady(): Promise<void>`;
`lockState.ts`: `isDataLocked(): boolean`, `setDataLocked(v: boolean): void`;
`useAppLock(onLocked: () => void): void` — no pedido: `setDataLocked(true)`, `await _flushPersist()`
se `isLoaded` (erro engolido: o main bloqueia no prazo), `await lockReady()`, `onLocked()`.

- [ ] Passo 1: testes:
  - `useAppLock`: pedido → `_flushPersist` antes de `lockReady`, depois `onLocked`;
    `isDataLocked()` true; com `isLoaded:false` não chama `_flushPersist`; falha do
    flush ainda chama `lockReady`.
  - `CloseLifecycle`: com `setDataLocked(true)` e `isLoaded:true`, o
    `app:flush-before-close` não chama `_flushPersist` e chama
    `flushBeforeCloseComplete`.
  - `AutoLockSettings`: rótulo `Bloquear automaticamente após` com opções
    `Nunca`, `5 min`, `15 min`, `30 min`, `1 h` (valores 0/5/15/30/60); interruptor
    `Bloquear quando o Windows bloquear a tela`; com `passwordEnabled:false` ambos
    `disabled` e o texto `Ative uma senha para usar o bloqueio automático.`
  - `store-flows` (`src/renderer/src/__tests__/integration/store-flows.test.ts`): com
    `setDataLocked(true)` e `isLoaded:true`, `applyRemoteChanges` de geração maior
    aplica o estado em memória **sem** chamar `storage.load` nem `storage.save`, mesmo
    com um `_persist` pendente.
  - Regressão do Foco 1 (em `useAppLock.test.tsx`, renderizando um componente que
    reproduz o efeito do `App`): bloquear e desbloquear não chama `storage.load` de
    novo e não altera `timeSpent` de uma task com cronômetro salvo.
- [ ] Passo 2: commit+push. Esperado: FALHA.
- [ ] Passo 3: implementar:
  - `App.tsx`: `useAppLock(() => setSecurityState('locked'))`; efeito de carga vira
    `if (securityState !== 'unlocked' || useKanbanStore.getState().isLoaded) return`;
    backup horário só com `securityState === 'unlocked'`; `onUnlocked` →
    `setDataLocked(false)` e `setSecurityState('unlocked')`; o status de senha usado
    pela `UnlockScreen` vem do mesmo `security.status()`.
  - `kanban.ts` `applyRemoteChanges`: se `isDataLocked()`, só o `set(...)` em memória
    (o bloqueio já salvou; `storage.*` seria recusado).
  - `App.tsx` `onReload` (`store:reload`): bloqueado → guarda `reloadPending` e chama
    `loadData()` ao desbloquear; desbloqueado → como hoje.
  - `CloseLifecycle.tsx`: `if (state.isLoaded && !isDataLocked()) await state._flushPersist()`
    nos dois caminhos (fechar e instalar).
  - `AutoLockSettings` dentro da seção "Senha" de `SettingsView`, abaixo dos botões.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(security): tela de senha ao bloquear sem recarregar o app`.

### Task 6: Sync e sinal de vida com o app bloqueado

**Arquivos:** Modificar `src/main/index.ts`; Teste
`src/main/__tests__/handlers.test.ts`.
**Interfaces:** Consome `engine.start()` (idempotente, `packages/core/src/sync/engine.ts`).
O motor inicia logo depois de `registerSyncHandlers`, não no `store:load`;
`syncStartedByLoad` vira `syncStarted` (ligado nesse ponto) e o `onSyncHoldChanged`
continua usando-o; `store:load` deixa de chamar `start()`.

- [ ] Passo 1: teste em `handlers.test.ts` com senha configurada e app bloqueado:
  espiando `createSyncEngine` (`vi.mock('@sagyou/core/sync/engine', …)` envolvendo o
  real), `start` foi chamado antes de qualquer `security:unlock`, e `sync:now` continua
  recusado pelo IPC bloqueado.
- [ ] Passo 2: commit+push. Esperado: FALHA (`start` só no `store:load`).
- [ ] Passo 3: implementar; `let syncStarted = false` fica no topo, onde está hoje
  `syncStartedByLoad`; atualizar os comentários obsoletos (declaração de `syncEngine`,
  de `syncStartedByLoad` e o do `store:load`).
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): sync continua com o Sagyou bloqueado`.

### Task 7: Verificação no Windows, docs e PR

- [ ] CI completo verde (typecheck, lint do diff, testes, coverage).
- [ ] Luis testa no app instalado/dev no Windows: X esconde (aviso aparece uma vez);
  clique no ícone volta; abrir de novo pelo menu Iniciar foca a janela; Iniciar com o
  Windows abre escondido; bloquear com Win+L bloqueia o Sagyou; 5 min sem teclado/mouse
  (opção "5 min") bloqueia; Fleet com terminal aberto volta
  intacto; Claude no Fleet recebe o texto de bloqueio numa chamada MCP; Sair salva uma
  edição feita 1 s antes; desligar o Windows com o app na bandeja não perde a última
  edição; outro aparelho mostra o PC "visto" recente com o app bloqueado.
- [ ] Atualizar `CLAUDE.md` (bandeja, `desktop-prefs.json` na tabela de `userData`,
  bloqueio, sync antes do desbloqueio, novos IPC), `GUIDE.md` (regras que mordem:
  não recarregar no desbloqueio, esconder ≠ sair) e `README.md` (recursos).
- [ ] `/sagyou-review` (com `sagyou-security-reviewer`: IPC, MCP, bloqueio) e
  `/sagyou-pr`.
