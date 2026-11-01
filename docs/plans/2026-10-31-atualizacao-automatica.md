# Plano de implementação: Atualização automática pelos Releases do GitHub

Status: approved by Luis on 2026-10-31
Spec: docs/specs/2026-10-30-atualizacao-automatica.md
Branch: feature/sync-cloudflare (mesmo PR #30, por pedido de Luis)

**Objetivo:** a cada abertura, o app instalado consulta o Release estável mais novo do GitHub, baixa e instala com segurança, e o sync só começa depois disso.

**Arquitetura:** `electron-updater` (provedor GitHub) fica atrás de um módulo puro em `src/main/modules/update/` que recebe o atualizador por injeção e expõe um estado único (`UpdateStatus`) e uma trava (`isSyncHeld()`). O motor de sync consulta essa trava antes de cada ciclo, em vez de o `index.ts` reordenar a partida. "Reiniciar e instalar" reaproveita o handshake de fechamento (`app:flush-before-close`) e a parada dos agentes; só chama `quitAndInstall` se o flush confirmar.

## Restrições Globais

- Repositório: `luisgomes2002/Sagyou`, público; nenhum token GitHub no app.
- Consulta em **toda abertura**, em segundo plano, depois de `createWindow()`; a janela nunca espera a rede.
- Prazo da consulta para liberar o sync: **10 segundos** (`UPDATE_SYNC_GRACE_MS = 10_000`).
- Só Release publicado e estável, versão **maior** que a instalada (`allowPrerelease = false`, `allowDowngrade = false`).
- Desligado em: `is.dev`, `!app.isPackaged`, `process.env.SNAP`, e sempre que `process.resourcesPath/app-update.yml` não existir (build extraído/`--dir`). Desligado = estado `disabled`, sem aviso, sync liberado na hora.
- macOS sem assinatura: não baixa (`autoDownload = false`); estado `manual` com "Nova versão disponível" e "Abrir Release" → `https://github.com/luisgomes2002/Sagyou/releases/tag/v<versão>`, aberto via `safeExternalUrl`.
- `.deb` (lido de `process.resourcesPath/package-type` === `deb`): `autoInstallOnAppQuit = false`; nas outras plataformas, `true`.
- Textos exatos (pt-BR): "Verificando atualizações…", "Baixando versão <v> — <n>%", "Atualização pronta", "Reiniciar e instalar", "Depois", "Não foi possível verificar atualizações", "Tentar novamente", "Nova versão disponível", "Abrir Release", "Não foi possível salvar antes de instalar; tente de novo", e no sync: "Sincronização em espera: começa depois da atualização".
- Sem mudança de schema, de backup nem de `userData`. Nenhum dado do usuário em chamada do atualizador ou no log.
- Log: área nova `update`, eventos `check_failed`, `download_failed`, `install_aborted`, `install_started`; só `version`/`percent`/`msg` de erro passando por `scrubSecrets`.
- Testes: unitários com `npx vitest run <arquivo>` (o `CLAUDE.md` global permite unitários locais); o CI do PR é a prova final. Nenhum e2e local.

## Foco de Review

1. **Instalar sem salvar perde trabalho.** Se o renderer não confirma o flush em 10 s, ou a parada dos agentes falha, não chama `quitAndInstall`; o estado volta para `ready` com "Não foi possível salvar antes de instalar; tente de novo". Testado na Task 3.
2. **Release incompleto quebra a atualização de todo mundo.** O workflow falha (não publica) se faltar instalador, `latest*.yml` ou `.blockmap`, ou se a tag ≠ `package.json`. A Task 1 confere a configuração por texto. A prova de que o passo falha de verdade só vem no primeiro Release.
3. **GitHub fora do ar trava o sync para sempre.** Erro ou 10 s sem resposta liberam o sync; só uma resposta "há versão nova" o segura. Testado na Task 2.
4. **Dados existentes no `userData` (SQLite, anexos, backups).** O NSIS não pode ganhar `deleteAppDataOnUninstall: true` e `appId`/`productName` não mudam (mudar o `appId` troca a pasta e "perde" o banco). Testado na Task 1.
5. **Build dev/extraído/Snap tentando se atualizar.** Fica `disabled`, sem rede e sem aviso. Testado na Task 2.

### Task 1: Releases atualizáveis (Atualização 1/4)

**Arquivos:**
- Modificar `electron-builder.yml`: `publish: { provider: github, owner: luisgomes2002, repo: Sagyou, releaseType: release }`; `mac.target: [dmg, zip]` (o atualizador do macOS exige o zip) e `mac.artifactName: ${name}-${version}-mac.${ext}`. O default usaria `productName` (`Sagyou-…`, maiúsculo) e não casaria com o glob. O `dmg` mantém o próprio `artifactName`.
- Modificar `package.json`: scripts `build:win`, `build:mac`, `build:linux` ganham `--publish never` (com publish GitHub, o electron-builder tentaria publicar sozinho numa tag de CI); dependência `electron-updater` (`^6`).
- Modificar `.github/workflows/release.yml`:
  - job `check` ganha um passo que falha se `${GITHUB_REF_NAME#v}` ≠ `version` do `package.json`;
  - uploads: Windows `dist/sagyou-*-setup.exe`, `dist/*.blockmap`, `dist/latest.yml`; mac `dist/sagyou-*.dmg`, `dist/sagyou-*-mac.zip`, `dist/*.blockmap`, `dist/latest-mac.yml`; Linux `dist/sagyou-*.AppImage`, `dist/sagyou-*.deb`, `dist/latest-linux.yml` — todos com `if-no-files-found: error`;
  - a linha de comando Linux ganha `--publish never`;
  - `softprops/action-gh-release` com `fail_on_unmatched_files: true`.
- Teste: criar `src/main/__tests__/release-config.test.ts` (`@vitest-environment node`, lê os arquivos como texto).

**Interfaces — Produz:** `app-update.yml` dentro de `resources` do app empacotado (gerado pelo electron-builder a partir de `publish`), usado na Task 2.

- [ ] Passo 1: escreva os testes:
  - `electron-builder.yml` tem `provider: github`, `owner: luisgomes2002`, `repo: Sagyou` e não tem `example.com`;
  - `appId: com.sagyou.app` e `productName: Sagyou` continuam iguais, e não há `deleteAppDataOnUninstall: true`;
  - o mac tem target `zip`;
  - `release.yml` cita `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `*.blockmap`, `if-no-files-found: error`, `fail_on_unmatched_files: true` e o passo de versão;
  - os scripts `build:win/mac/linux` contêm `--publish never`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/release-config.test.ts`. Esperado: FALHA (publish ainda é `generic`).
- [ ] Passo 3: aplique as mudanças acima.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `build(release): publicar manifestos do atualizador no GitHub`.

### Task 2: núcleo do atualizador e trava do sync (Atualização 2/4)

**Arquivos:**
- Criar `src/main/modules/update/app-updater.ts`. Teste `src/main/__tests__/app-updater.test.ts`, com um atualizador falso (`EventEmitter` + `checkForUpdates`/`downloadUpdate`/`quitAndInstall` espiões) e timers falsos.
- Modificar `src/main/modules/sync/sync-engine.ts`: dep opcional `isHeld?: () => boolean`; novo `SyncStateName` `'update-pending'`. Teste em `src/main/__tests__/sync-engine.test.ts`.
- Modificar `src/main/modules/logs/logger.ts` se as áreas forem tipadas: adicionar `update`.

**Interfaces — Produz:**
```ts
type UpdateState = 'disabled' | 'checking' | 'none' | 'downloading' | 'ready' | 'manual' | 'error'
interface UpdateStatus { state: UpdateState; version: string | null; percent: number | null; releaseUrl: string | null; installError: boolean }
interface UpdaterLike extends EventEmitter { autoDownload: boolean; autoInstallOnAppQuit: boolean; allowPrerelease: boolean; allowDowngrade: boolean; checkForUpdates(): Promise<unknown>; quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void }
shouldEnableUpdater(env: { isDev: boolean; isPackaged: boolean; snap: boolean; hasUpdateYml: boolean }): boolean   // pura; index.ts só lê os fatos
createAppUpdater(deps: { updater: UpdaterLike; enabled: boolean; platform: NodeJS.Platform; isDeb: boolean; now(): number; setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void; emitStatus(s: UpdateStatus): void; onSyncReleased(): void; log: Pick<Logger, 'info' | 'warn' | 'error'> }): {
  start(): void; check(): Promise<UpdateStatus>; status(): UpdateStatus; isSyncHeld(): boolean;
  markInstallFailed(): void; quitAndInstall(): void
}
```

**Comportamento:**
- `start()` com `enabled: false` → `disabled`, `isSyncHeld()` false, nunca chama `checkForUpdates`.
- `start()` habilitado: configura `autoDownload = platform !== 'darwin'`, `autoInstallOnAppQuit = !isDeb && platform !== 'darwin'`, `allowPrerelease = false`, `allowDowngrade = false`; estado `checking`; arma o timer de 10 s. Uma segunda chamada a `start()`/`check()` durante `checking` não dispara outra consulta.
- `isSyncHeld()` é true em `checking` antes dos 10 s, e em `downloading` e `ready`; é false em `none`, `manual` (macOS sem assinatura, decisão de Luis em 31/10: o sync segue, só com o aviso), `error` sem versão conhecida e depois dos 10 s sem resposta.
- `update-not-available` → `none`; `error` antes de existir versão → `error` (loga `check_failed`); os dois liberam o sync e chamam `onSyncReleased()` uma vez.
- `update-available` → `downloading` (ou `manual` no darwin, com `releaseUrl`); se chegar depois dos 10 s, volta a segurar o sync. `download-progress` → `percent` arredondado. `update-downloaded` → `ready`. `error` com versão já conhecida → `error` (loga `download_failed`) e **mantém** o sync segurando (spec, item 4).
- `markInstallFailed()` → `ready` com `installError: true`.
- `onSyncReleased()` dispara a cada passagem de "segurado" para "livre", nunca duas vezes seguidas sem uma volta a segurar. `check()` (o "Tentar novamente") volta a `checking` e rearma o timer de 10 s.
- **No motor, a trava fica no cliente HTTP** (a função que fala com o Worker). Ela vale para tudo que baixa ou envia: ciclo automático, `syncNow`, `activate`, `join`, `resume`, `revoke` e cadastro do autenticador. Segurado, a função não chama `fetch` e a ação devolve o status. `update-pending` só substitui `ok`/`offline`, ou seja, só aparece com sessão configurada. `off`, `no-keychain`, `disconnected` e `paused` continuam como estão.

- [ ] Passo 1: escreva os testes:
  - desligado: estado `disabled`, zero chamadas a `checkForUpdates`, sync livre;
  - sem versão: `none`, sync livre, `onSyncReleased` chamado 1 vez;
  - erro de rede: `error`, sync livre;
  - 10 s sem resposta: sync livre e `onSyncReleased` chamado; uma `update-available` depois disso volta a segurar;
  - versão nova: `downloading` → progresso 42.7 vira `percent: 43` → `ready`, sync segurado em todo o caminho;
  - erro no download: `error`, sync continua segurado;
  - darwin: `autoDownload` false, estado `manual`, `releaseUrl` = `https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0`, sync livre e `onSyncReleased` chamado;
  - deb: `autoInstallOnAppQuit` false; win32: true;
  - duas chamadas a `check()` seguidas fazem 1 consulta;
  - motor de sync com `isHeld: () => true`: zero chamadas ao `fetch` em ciclo, `syncNow`, `activate` e `join`; estado `update-pending` com sessão e `off` sem sessão; ao liberar e chamar `syncNow()`, faz o ciclo;
  - `onSyncReleased`: 1 chamada em erro → `check()` → sem versão (só a primeira libera); 2 chamadas em libera → segura → libera;
  - `shouldEnableUpdater`: falso para dev, não empacotado, Snap e sem `app-update.yml`; verdadeiro só com os quatro fatos favoráveis.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/app-updater.test.ts src/main/__tests__/sync-engine.test.ts`. Esperado: FALHA (módulo não existe).
- [ ] Passo 3: implemente `createAppUpdater` (máquina de estados pura, sem importar `electron` nem `electron-updater`) e a checagem `isHeld` no início do ciclo do motor.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(update): verificar e baixar atualização, segurando o sync`.

### Task 3: ligar no main, instalar com flush e IPC (Atualização 2/4)

**Arquivos:**
- Modificar `src/main/handlers/window.ts`:
  - `ManagedWindow.flushForInstall(timeoutMs = 10_000): Promise<boolean>` envia `app:flush-before-close` e resolve `true` no `app:flush-before-close:complete`, sem fechar a janela, ou `false` no prazo.
  - `ManagedWindow.allowCloseForInstall(on: boolean)` liga ou desliga `allowClose`. Assim o `close` que o `quitAndInstall` provoca não dispara um segundo flush. Se a instalação abortar, volta a `false`.
  - Teste em `src/main/__tests__/window-close.test.ts`.
- Criar `src/main/handlers/update.ts`: `registerUpdateHandlers(ipcMain, deps)` com `update:status`, `update:check`, `update:install`, `update:open-release`; push `update:status-changed`. Teste em `src/main/__tests__/handlers.test.ts`.
- Modificar `src/main/index.ts`: cria o atualizador com `autoUpdater` de `electron-updater`, `enabled` pelas regras das Restrições, `updater.start()` logo depois de `createWindow()`; passa `isHeld: () => appUpdater.isSyncHeld()` ao `createSyncEngine` e `onSyncReleased: () => void syncEngine?.syncNow()`; registra os handlers depois de `protectDataIpc`.
- Modificar `src/preload/index.ts`: `update.{status, check, install, openRelease, onStatusChanged}`.

**Comportamento de `update:install`:**
1. só age em `ready`;
2. para os cronômetros dos agentes primeiro (`runTaskTimers.stopEverything()`, até 3 s), porque o tempo salvo passa pelo renderer, e marca `runTimersStoppedForQuit = true`;
3. `await managedWindow.flushForInstall()`; se `false` → `markInstallFailed()`, loga `install_aborted`, retorna o status com o app intacto;
4. `allowCloseForInstall(true)`, loga `install_started` e chama `quitAndInstall(true, true)` (Windows silencioso e reabre; no `.deb` o próprio electron-updater pede a autenticação do sistema). O `before-quit` que vem em seguida faz o resto da parada de sempre (`rendererMcp*.close()`, `syncEngine.stop()`, `stopCodeAgent()`, todos já seguros de repetir). Se `quitAndInstall` lançar → `allowCloseForInstall(false)` + `markInstallFailed()`.
`update:open-release` só abre o `releaseUrl` do estado atual, nunca uma URL vinda do renderer.

- [ ] Passo 1: escreva os testes:
  - `flushForInstall` resolve `true` com o ack e a janela continua aberta; resolve `false` em 10 s sem ack;
  - um fechamento normal continua fechando como antes (regressão);
  - `update:install` com flush falho não chama `quitAndInstall` e o status fica `installError: true`;
  - com flush ok, a ordem é cronômetros → flush → `allowCloseForInstall(true)` → `quitAndInstall(true, true)`, e o `close` seguinte não manda um segundo `app:flush-before-close`;
  - `quitAndInstall` que lança deixa `allowClose` falso de novo (um fechamento normal volta a pedir flush);
  - `update:install` fora de `ready` não faz nada;
  - `update:open-release` ignora argumento do renderer e abre só a URL do estado;
  - os handlers `update:*` estão atrás de `protectDataIpc` (registrados depois dele na ordem capturada).
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/handlers.test.ts src/main/__tests__/window-close.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode o mesmo comando e `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(update): reiniciar e instalar sem perder o que não foi salvo`.

### Task 4: telas (Atualização 3/4)

**Arquivos:**
- Criar `src/renderer/src/components/settings/UpdateSettings.tsx` (seção em Configurações) e `src/renderer/src/components/layout/UpdateBanner.tsx` (faixa fina no topo da área de conteúdo, sem modal e sem roubar foco, só em `ready`/`manual`, fechável com "Depois" até a próxima mudança de estado). Testes `src/renderer/src/__tests__/components/UpdateSettings.test.tsx` e `UpdateBanner.test.tsx`.
- Modificar a view de Configurações (onde `SyncSettings` é montado) e o layout do `App.tsx` para montar os dois.
- Modificar `SyncSettings.tsx`: estado `update-pending` com "Sincronização em espera: começa depois da atualização".
- Seguir a skill `sagyou-ui` / `UI_DESIGN.md`.

- [ ] Passo 1: escreva os testes:
  - cada estado mostra o texto exato das Restrições (`disabled` e `none` não mostram nada além da versão instalada);
  - `error` mostra "Tentar novamente", que chama `update.check`;
  - `ready` mostra "Reiniciar e instalar" (chama `update.install`) e "Depois" (esconde a faixa, não chama nada no main);
  - `installError` mostra "Não foi possível salvar antes de instalar; tente de novo";
  - `manual` mostra "Nova versão disponível" e "Abrir Release" (chama `update.openRelease`);
  - `SyncSettings` em `update-pending` mostra o texto do sync.
- [ ] Passo 2: rode `npx vitest run src/renderer/src/__tests__/components/UpdateSettings.test.tsx src/renderer/src/__tests__/components/UpdateBanner.test.tsx src/renderer/src/__tests__/components/SyncSettings.test.tsx`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(update): estado da atualização em Configurações e faixa de pronto`.

### Task 5: suíte, documentação e verificação (Atualização 4/4)

- [ ] `npm run typecheck`, `npm run lint` e `npm test` (via `sagyou-test-runner`); CI do PR #30 verde.
- [ ] `npm run dev`: Configurações mostra o atualizador como desligado e o sync segue normal (o dev nunca consulta).
- [ ] Atualizar `CLAUDE.md` (módulo `update/`, canais `update:*`, trava do sync, área de log `update`, release com manifestos), `GUIDE.md` (regra: não mudar `appId`/`productName`; release exige manifestos) e `README.md` (atualização automática; o primeiro Release com o recurso é instalado à mão; macOS sem assinatura abre o Release). Atualizar o adendo da spec do sync dizendo que o portão foi implementado.
- [ ] Smoke de instalação (fora do CI, por Luis, depois do merge): instalar a versão N à mão no Windows, publicar N+1, abrir e confirmar download → "Reiniciar e instalar" → app reabre em N+1 com os dados. Repetir com AppImage.
- [ ] PR: entra no #30 (estágio 5, `sagyou-review` antes).

## Decisões do construtor

- macOS sem assinatura (estado `manual`) **não** segura o sync; só mostra "Nova versão disponível" e "Abrir Release" (Luis, 31/10, opção b).

- Uma trava consultada pelo motor (`isHeld`) em vez de atrasar `syncEngine.start()`: cobre também a versão que aparece depois dos 10 s sem reordenar a partida no `index.ts`.
- Durante os primeiros 10 s de `checking`, o sync aparece como `update-pending`; é breve e diz a verdade.
- Os canais `update:*` ficam atrás de `protectDataIpc`: a consulta ao GitHub roda mesmo com o app bloqueado (não envia dado algum), mas a tela e o "Reiniciar e instalar" só existem desbloqueados.
- "Depois" é só do renderer (esconde a faixa); Configurações continua mostrando "Atualização pronta".
- Só x64, como os builds de hoje.
- Testes unitários rodam localmente (regra do `CLAUDE.md` global). O plano do sync dizia "testes não rodam localmente"; se essa regra ainda valer, os passos 2 e 4 viram "commit e conferir no CI".
