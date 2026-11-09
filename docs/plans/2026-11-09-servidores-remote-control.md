# Plano de implementação: o Sagyou gerencia os servidores de Remote Control

Status: approved by Luis on 2026-11-09
Spec: docs/specs/2026-11-09-servidores-remote-control.md
Branch: feature/servidores-remote-control

**Objetivo:** o Sagyou sobe, encerra e religa um `claude remote-control` por projeto, e o
celular liga e desliga cada um.

**Arquitetura:** um gerenciador no main (`modules/remote/rc-manager.ts`, efeitos injetados)
é dono dos PTYs dos servidores, da confirmação, do religar e da detecção de servidores de
fora. O `remote-service` atende `server-start`/`server-stop` e manda os servidores no
status. O renderer mostra a lista em Configurações e uma aba por servidor no Fleet; o
celular ganha a seção "Servidores" na aba PC.

## Restrições Globais

- Testes rodam **só no CI** (preferência do Luis): "rode" = push e `gh pr checks`.
- Comando: `claude remote-control --name "<projeto>" --spawn worktree --permission-mode manual`; `--spawn same-dir` se a pasta não tem `.git`. Executável por `resolveHarnessExecutable('claude')`, PTY por `startAgentPty`, `cwd` = pasta, nada de shell.
- Pasta do projeto: o primeiro caminho de código **ativo** (`activeCodePathIds`, senão `activeCodePathId`) que exista neste PC (`existsSync`). Projeto arquivado (`archivedAt`) ou sem pasta: sem servidor.
- Confirmado: servidor iniciado **no PC** (`origin: 'pc'`) rodando 60 s (`RC_CONFIRM_MS = 60_000`); grava `confirmedAt` (ISO) e `path`. Pasta diferente de `path` = não confirmado.
- Religar: `RC_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000]`; volta ao início depois de `RC_STABLE_MS = 600_000` rodando.
- Kinds novos: `server-start`, `server-stop`, `MAX_TTL_MS` 1 min, corpo `{ projectId }` (string ≤ 64).
- `ResultReason` novos: `not-confirmed`, `cut`, `unknown-server`, `start-failed`. Nenhum conta para a suspensão; `suspended` bloqueia só `server-start`.
- Estados: `running`, `stopped`, `starting`, `needs-confirm`, `external`. Textos no PC: `Rodando`, `Parado`, `Iniciando…`, `Confirme no Fleet`, `Rodando (fora do Sagyou)`.
- Textos no celular (`REMOTE_TEXT`): `serverNotConfirmed` "Confirme este projeto uma vez no PC.", `serverCut` "O acesso está cortado. Restaure antes de ligar um servidor.", `serverUnknown` "Este servidor não existe mais no PC.", `serverFailed` "O servidor não subiu. Veja o terminal no PC.".
- Textos no PC: dica da 1ª vez "Responda às perguntas do Claude no Fleet. Depois disso, o celular também liga este servidor."; rodapé "Só aparecem projetos com uma pasta de código."; sem `claude`: "Claude Code não encontrado".
- Logs (área `remote`): `server_start`, `server_stop`, `server_exit` (`code`), `server_restart`, `server_refused` (`reason`), `server_migrated` (`count`), sempre com `projectId`; nunca comando, pasta ou saída.
- Só Windows (`process.platform === 'win32'`); fora dele o gerenciador fica vazio e a seção não aparece.
- Versões: desktop `1.10.0`, celular `0.6.0` (`versionCode` 600), assumindo o #53 (1.9.0/0.5.0) mesclado antes; se não, ajustar na Task 8.

## Decisões do construtor (respostas ao verificador)

1. **`needs-confirm`** = PTY vivo e projeto não confirmado para a pasta atual (antes dos 60 s ou nunca). **`enabled`** é campo da entrada: `RcServerEntry` ganha `enabled: boolean`; desmarcar "Servidor de Remote Control" grava `enabled: false`, encerra o servidor e **mantém** `confirmedAt`/`path`. Nomes migrados entram com `enabled: true`.
2. **Retorno ao celular:** o `onChange` do gerenciador chama `service.statusSoon()`, que zera `lastStatusAt`; o próximo `tick` (≤ 5 s) manda o status. Sem estado otimista no celular.
3. **Migração:** roda uma vez no `index.ts`, logo depois de criar o gerenciador e antes de `createRemoteService`; grava na hora (`legacyServerNames: []`, `migrateServerNames` já devolve assim); descartados só contam no `server_migrated`. Depois disso o status **nunca** tem nome legado (a Task 4 não manda mais `{name, up}` legado).
4. **Aba de servidor:** componente novo `fleet/ServerTerminal.tsx`, que usa o `InteractiveTerminal` (exportado de `AgentTerminal.tsx`) com `onInput`/`onResize` chamando `rcServers.terminalInput/terminalResize`; não precisa de `AgentRun`. `rc-server:terminal-reconnect` devolve `{ success: boolean; log?: string; cols?: number; rows?: number }`, o mesmo contrato do agente; `liveTerminals` escolhe a API pelo prefixo `server:`.
5. **Saída e religar:** `rc-server:exit` só no encerramento definitivo (desligado, corte, Sagyou fechando, projeto removido, ou saída sem `autostart`). Numa queda com religar, o terminal continua; o gerenciador escreve no buffer e no `rc-server:output` a linha `
[Sagyou] O servidor saiu (código N). Tentando de novo em S s.
`, e o buffer (8000 caracteres) não zera.
6. **Onde nasce:** no bloco remoto do `index.ts`, depois do `protectDataIpc` e antes de `createRemoteService`; os canais `rc-server:*` são registrados depois do `protectDataIpc`. `projects()` vem de uma função nova e leve em `store.ts`, `listProjectCodeRoots()` (`id`, `name`, `archived_at` + `project_code_paths`), mapeada pela função pura `projectServerPath(project, exists)` (primeiro caminho ativo que existe). `refresh()` roda depois de cada `store:save` bem-sucedido, depois de `applyRemoteChanges` e no heartbeat. `startAutostart()` roda ao abrir **mesmo com o Sagyou bloqueado** (consequência da decisão 2 da spec: o servidor não lê dados do Sagyou, e é para isso que o login automático existe).
7. **Plataforma:** `rc-server:list` devolve `{ supported: boolean; servers: RcServerView[] }` (`supported` = Windows). A seção aparece com `supported`, mesmo com o controle remoto desligado (os servidores servem sem o celular).
8. **Corte:** o laço `killServersWhileCut` continua (pega servidores de fora); o gerenciador não religa nada enquanto `accessCut()`, então uma saída provocada pelo laço não briga com ele. `onAccessCut` chama `stopAll('cut')` antes do laço.
9. `RemoteStatusView.servers` e o tipo `RemoteStatus.servers` do renderer **saem** (a lista vem de `rc-server:list`); a prop `suggestions` de `RemoteControlSettings` sai junto (e o `SettingsView` deixa de passá-la).
10. **Biometria no celular:** a do `keys.sign` (chave com `requireAuthentication`) basta; sem `authenticate()` extra, um prompt só.

## Foco de Review

1. **`remote-control.json` existente** com `servers: ["Sagyou", "Murasaki"]`: vira entradas pelo nome do projeto (sem diferenciar maiúsculas, só com um único projeto de mesmo nome), `enabled: true`, `autostart: true`, `confirmedAt: null`; nome sem projeto sai com `server_migrated`. Ler duas vezes não duplica. Testado nas Tasks 2 e 5.
2. **Corte e suspensão:** com `accessCutAt`, nada sobe (nem autostart, nem religar, nem PC, nem celular); restaurar religa só os com `autostart`. Suspenso: `server-start` recusado, `server-stop` passa. Testado nas Tasks 3 e 4.
3. **Servidor de fora** com o mesmo `--name`: não sobe outro; "Desligar" encerra só os PIDs daquele nome (`remoteControlTargets` filtrado pelo nome), nunca o próprio Sagyou. Testado na Task 3.
4. **Religar não vira laço:** desligado pelo usuário não religa; saída com código ≠ 0 em sequência respeita o backoff; o teto é 15 min. Testado na Task 3.
5. **Projeto apagado, arquivado ou com pasta trocada:** o servidor é encerrado e some da lista; pasta trocada desfaz a confirmação. Testado na Task 3.
6. **Celular 0.5 com PC novo / celular novo com PC 0.5:** `PcStatus.servers` mantém `name` e `up`; o celular novo trata `state`/`projectId` ausentes como servidor só observado (sem botões). Testado nas Tasks 1 e 7.

### Task 1: protocolo e estado (core)

**Arquivos:**
- Modificar `packages/core/src/control/messages.ts` (`ControlKind`, `MAX_TTL_MS`, `PcStatus.servers`, `parsePcStatus`), `packages/core/src/control/bodies.ts` (`parseServerRequest`, `ResultReason`), `packages/core/src/control/state.ts` (`missing`)
- Teste `packages/core/src/control/__tests__/messages.test.ts`, `bodies.test.ts`, `state.test.ts`

**Interfaces:** Produz `type ServerState = 'running' | 'stopped' | 'starting' | 'needs-confirm' | 'external'`; `PcStatus.servers: { name: string; up: boolean; projectId?: string; state?: ServerState; autostart?: boolean }[]`; `parseServerRequest(body): { projectId: string } | null`.

- [ ] Passo 1: testes: `parsePcStatus` aceita servidor só com `{name, up}` (PC antigo) e com os campos novos; descarta `state` desconhecido (fica sem `state`); `parseServerRequest({projectId:'p1'})` → ok, `''`/65 chars/ausente → null; `MAX_TTL_MS['server-start']` = 60 000; `pcState`: com `autostart: false` e `up: false` o PC fica `ready` e `missing` vazio; sem `autostart` (PC antigo) conta como hoje.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente; `missing = servers.filter((s) => s.autostart !== false && !s.up)`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(core): mensagens e estado dos servidores de Remote Control`

### Task 2: config dos servidores e migração

**Arquivos:**
- Modificar `apps/desktop/src/main/modules/remote/remote-config.ts`
- Teste `apps/desktop/src/main/__tests__/remote-config.test.ts`

**Interfaces:** Produz `interface RcServerEntry { projectId: string; enabled: boolean; autostart: boolean; confirmedAt: string | null; path: string | null }`; `RemoteConfig.servers: RcServerEntry[]`; `RemoteConfig.legacyServerNames: string[]` (só leitura de arquivo antigo, nunca gravado); `migrateServerNames(config, projects: { id: string; name: string }[]): { config: RemoteConfig; dropped: number }`.

- [ ] Passo 1: testes: arquivo com `servers: ['Sagyou']` → `servers: []`, `legacyServerNames: ['Sagyou']`; `migrateServerNames` com projeto "sagyou" → entrada `{autostart:true, confirmedAt:null, path:null}`, `dropped` conta nome sem projeto e nome com dois projetos; rodar de novo não duplica; arquivo novo faz round-trip; entrada malformada descartada; máximo 50; o arquivo gravado nunca tem `legacyServerNames`.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente no normalizador (`isString` → legado; objeto → entrada).
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): servidores por projeto no remote-control.json`

### Task 3: gerenciador dos servidores

**Arquivos:**
- Criar `apps/desktop/src/main/modules/remote/rc-manager.ts`
- Modificar `apps/desktop/src/main/modules/remote/rc-servers.ts` (`killRemoteControlServerNamed(exec, name, selfPid)` sobre `remoteControlTargets` + `namesIn`)
- Teste `apps/desktop/src/main/__tests__/rc-manager.test.ts`, `rc-servers.test.ts`

**Interfaces:** Consome `RcServerEntry`. Produz:
```ts
interface RcProject { id: string; name: string; path: string | null }
interface RcServerView { projectId: string; name: string; enabled: boolean; autostart: boolean;
  state: ServerState; confirmed: boolean; error: string | null }
createRcManager(deps: { platform; projects(): RcProject[]; entries(): RcServerEntry[];
  saveEntries(e: RcServerEntry[]): void; resolveClaude(): string | null;
  hasGit(dir: string): boolean; spawn(o: AgentPtyOptions): AgentPty;
  externalNames(): Promise<string[]>; killExternal(name: string): Promise<number>;
  accessCut(): boolean; now(); setTimer; clearTimer; log; onOutput(id, chunk); onExit(id); onChange() })
→ { list(): RcServerView[]; start(projectId, origin: 'pc' | 'phone'):
  Promise<'ok' | 'not-confirmed' | 'cut' | 'unknown-server' | 'start-failed'>;
  stop(projectId): Promise<'ok' | 'unknown-server'>; configure(projectId, { enabled?, autostart? }): void;
  startAutostart(): Promise<void>; stopAll(reason: 'cut' | 'quit'): void; refresh(): Promise<void>;
  input(id, data): boolean; resize(id, cols, rows): boolean; snapshot(id): { log: string } | null }
```
O id do terminal é `server:<projectId>`; o buffer guarda os últimos 8000 caracteres (como `MAX_AGENT_LOG`).

- [ ] Passo 1: testes (PTY falso, relógio falso):
  - `start('p1','pc')` chama `spawn` com `command` = claude resolvido, `args` exatos (com `--spawn worktree`; `same-dir` quando `hasGit` = false), `cwd` = pasta; estado `starting` → `running` no primeiro dado.
  - 60 s rodando a partir do PC grava `confirmedAt` e `path`; a partir do celular nunca grava.
  - `start('p1','phone')` sem confirmação → `not-confirmed` sem `spawn`; com `path` diferente da pasta atual → `not-confirmed`.
  - `accessCut()` → `cut` para PC e celular; `startAutostart` não sobe nada; `stopAll('cut')` mata os PTYs e não religa.
  - Saída inesperada com `autostart`: religa em 30 s, 1 min, 2 min…, teto 15 min; depois de 10 min rodando volta a 30 s. `stop` do usuário: não religa. Sem `autostart`: não religa.
  - `externalNames()` com o nome → estado `external`, `start` não chama `spawn` e responde `ok`; `stop` chama `killExternal(name)`.
  - Dois `start` seguidos: um `spawn`.
  - Projeto sumiu/arquivado/sem pasta no `refresh()`: PTY morto, fora da `list()`, `onExit` emitido.
  - Pasta trocada com o servidor rodando: encerrado, e a entrada perde a confirmação para a pasta nova (`path` ≠ pasta → `needs-confirm` ao ligar no PC).
  - Queda com `autostart`: `onExit` **não** é emitido; `onOutput` recebe a linha `[Sagyou] O servidor saiu (código 1). Tentando de novo em 30 s.`.
  - `needs-confirm` enquanto vivo e não confirmado; `running` depois de confirmado.
  - `configure(id, {enabled:false})` encerra e mantém `confirmedAt`.
  - `projectServerPath`: primeiro caminho ativo existente; `activeCodePathId` legado; nenhum → null.
  - `resolveClaude()` null → `start-failed`, `error` = "Claude Code não encontrado".
  - `rc-servers.test`: `killRemoteControlServerNamed` só mira linhas `remote-control` com aquele `--name`, nunca `selfPid` nem filhos.
- [ ] Passo 2: rode (CI). Esperado: FALHA (módulo inexistente).
- [ ] Passo 3: implemente; estado por projeto num `Map`, timers por `setTimer`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): gerenciador dos servidores de Remote Control`

### Task 4: o PC atende o celular

**Arquivos:**
- Modificar `apps/desktop/src/main/modules/remote/remote-service.ts` (`controllerRequest`, `heartbeat`, deps)
- Teste `apps/desktop/src/main/__tests__/remote-service.test.ts`

**Interfaces:** Consome a Task 3. Deps novos: `serverList(): RcServerView[]`, `startServer(id, 'phone')`, `stopServer(id)`; `servers()` passa a montar `PcStatus.servers` só com os gerenciados habilitados (`name`, `up` = `running|external|needs-confirm`, `projectId`, `state`, `autostart`). Produz `service.statusSoon()`.

- [ ] Passo 1: testes: `statusSoon()` faz o próximo `tick` mandar status mesmo antes de 30 s; `server-start` válido → `startServer('p1','phone')` e `ok`; resultado `not-confirmed`/`cut`/`unknown-server`/`start-failed` vira `reason` igual, `failures` não sobe; suspenso → `suspended` sem chamar `startServer`; `server-stop` suspenso → passa; corpo inválido → `shape`; status do heartbeat traz os campos novos.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: dois `case` novos no `switch` de `controllerRequest`; nenhum chama `accepted()` em recusa.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): ligar e desligar servidor pelo celular`

### Task 5: IPC, preload e ligação no main

**Arquivos:**
- Criar `apps/desktop/src/main/handlers/rc-servers.ts`
- Modificar `apps/desktop/src/main/index.ts` (criar o gerenciador depois do `loadData`, `startAutostart` ao abrir, `refresh` depois de cada `store:save`, `stopAll('cut')` no `onAccessCut`, `startAutostart` no `onAccessRestored`, `stopAll('quit')` no `before-quit`, migração dos nomes com `server_migrated`), `apps/desktop/src/main/handlers/remote.ts` (remove `remote:servers:set`), `apps/desktop/src/preload/index.ts`
- Modificar também `apps/desktop/src/main/store.ts` (`listProjectCodeRoots()`, SQL só verificado no app)
- Teste `apps/desktop/src/main/__tests__/rc-servers-handlers.test.ts`, `handlers.test.ts` (registro depois de `protectDataIpc`, canal `remote:servers:set` fora da lista ~l.312), `remote-handlers.test.ts` (tirar o teste de `remote:servers:set` ~l.210-224 e o `servers` do status)

**Interfaces:** Canais `rc-server:list`, `rc-server:configure(projectId, {enabled?, autostart?})`, `rc-server:start(projectId)` (origem `pc`), `rc-server:stop(projectId)`, `rc-server:terminal-input(id, data)`, `rc-server:terminal-resize(id, cols, rows)`, `rc-server:terminal-reconnect(id)`; main→renderer `rc-server:changed`, `rc-server:output({id, chunk})`, `rc-server:exit({id})`. Entrada validada com `isAgentTerminalInput`/`isAgentTerminalSize`; `projectId` string ≤ 64.

- [ ] Passo 1: testes: `rc-server:list` devolve `{ supported, servers }`; `rc-server:terminal-reconnect` devolve `{ success, log }`; canais registrados depois de `protectDataIpc`; `projectId` inválido → erro sem chamar o gerenciador; input/resize inválidos recusados; `remote:servers:set` não existe mais.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente e ligue no `index.ts`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): IPC dos servidores de Remote Control`

### Task 6: telas do desktop

**Arquivos:**
- Modificar `apps/desktop/src/renderer/src/components/settings/RemoteControlSettings.tsx` (seção refeita), `apps/desktop/src/renderer/src/components/ai/liveTerminals.ts` (escuta também `rc-server:output/exit`, reconnect por `rc-server:terminal-reconnect` quando o id começa com `server:`), `apps/desktop/src/renderer/src/components/ai/FleetView.tsx` e `fleet/SessionTabs.tsx` (`kind: 'run' | 'server'`, aba "Servidor: <projeto>" com terminal e **Desligar**)
- Criar `apps/desktop/src/renderer/src/components/ai/fleet/ServerTerminal.tsx`; modificar `AgentTerminal.tsx` (exporta `InteractiveTerminal`), `SettingsView.tsx` (sem `suggestions`)
- Teste `apps/desktop/src/renderer/src/__tests__/components/RemoteControlSettings.test.tsx`, `FleetView.test.tsx`, `SessionTabs.test.tsx`

- [ ] Passo 1: testes: lista mostra só projetos com pasta, com os estados em texto exato; "Servidor de Remote Control" e "Iniciar com o Sagyou" chamam `configure`; **Ligar** chama `start` e abre a aba; dica da 1ª vez aparece em `needs-confirm`; rodapé "Só aparecem projetos com uma pasta de código."; com `rc-server:list` → `{ supported: false }` a seção não aparece; com o controle remoto desligado e `supported` a seção aparece; no Fleet a aba "Servidor: Sagyou" aparece com o servidor rodando e **Desligar** chama `stop`.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente seguindo `UI_DESIGN.md` (skill `sagyou-ui`).
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(ui): servidores de Remote Control nas Configurações e no Fleet`

### Task 7: celular

**Arquivos:**
- Modificar `apps/mobile/src/remote/store.ts` (`startServer(projectId)`, `stopServer(projectId)` via `sendToPc`; `resultText` com os 4 motivos), `apps/mobile/src/remote/texts.ts`, `apps/mobile/src/screens/PcScreen.tsx` (seção "Servidores")
- Teste `apps/mobile/src/remote/__tests__/store.test.ts`, `apps/mobile/src/screens/__tests__/PcScreen.test.tsx`

- [ ] Passo 1: testes: `startServer('p1')` manda `server-start` `{projectId:'p1'}` assinado; cada motivo vira o texto exato; a seção lista os servidores com estado e botão (**Ligar** parado, **Desligar** rodando/fora do Sagyou); servidor sem `projectId` (PC antigo) aparece sem botão; o varredor de a11y continua verde (48 dp, rótulos).
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente com `ListItem`/`Button` e tokens do `theme.ts`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): ligar e desligar servidores pela aba PC`

### Task 8: docs, guia, versões e PR

**Arquivos:** `CLAUDE.md` (remote control: gerenciador, canais `rc-server:*`, `remote-control.json` com `servers` novos), `GUIDE.md`, `README.md` (sem tarefa do Agendador; tela nova), `docs/specs/2026-10-30-sync-mobile-roteiro.md` (decisão atualizada), guia do desktop (`guide/content.ts` ou `sync-content.ts`, o artigo do controle remoto), `apps/desktop/package.json` 1.10.0, `apps/mobile/app.json`/`package.json` 0.6.0 / 600, `package-lock.json`.

- [ ] Passo 1: atualize os textos (o teste do guia continua pinando os comandos `wrangler`).
- [ ] Passo 2: push, `gh pr checks`: typecheck, testes e lint verdes.
- [ ] Passo 3: `sagyou-review` com `sagyou-security-reviewer` (PTY, execução remota) e `sagyou-ui-reviewer`, depois `sagyou-pr`.
- [ ] Passo 4: no PR, para o Luis: confirmar cada projeto uma vez no PC; apagar a tarefa antiga do Agendador; testar ligar/desligar pelo celular no 4G.
- [ ] Passo 5: commit `docs(servidores-remote-control): docs, guia e versões`
