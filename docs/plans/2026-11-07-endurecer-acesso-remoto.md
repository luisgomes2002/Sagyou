# Plano de implementação: Endurecer o acesso remoto

Status: approved by Luis on 2026-11-07
Spec: docs/specs/2026-11-07-endurecer-acesso-remoto.md
Branch: feature/endurecer-acesso-remoto

**Objetivo:** cartão nas escritas arriscadas do token externo, só leitura com o Sagyou
bloqueado, Cortar/Restaurar acesso pelo celular, convite com o autenticador e pedido
remoto por 1 h.

**Arquitetura:** o token externo passa a usar a mesma fila e o mesmo `createRemoteCards`
dos cartões do Fleet, com um mapa de pendentes próprio e um diálogo no renderer. O corte é
um estado do `remote-control.json` lido pelo broker (token suspenso) e pela varredura de
servidores (que passa a encerrar processos); duas mensagens de controle novas
(`cut-access`, `restore-access`), e o restaurar passa por uma rota do Worker que confere o
fator e marca a mensagem. O convite ganha o cabeçalho `x-totp-code` no core e no Worker.

## Restrições Globais

- Testes **não** rodam localmente: cada "rode" abaixo é push na branch e leitura do CI
  (`gh pr checks` / `gh run watch`), como no plano do #44. Sem `npm install` na worktree.
- Prazo do cartão: `MCP_APPROVAL_TIMEOUT_MS` (5 min), já existente.
- Cartão no token externo = `MCP_APPROVAL_REQUIRED.has(name)`; `save_memory` e
  `criar_task` **sem** cartão no token externo.
- Nome da sessão no cartão: `Acesso externo`.
- Texto da escrita bloqueada (token externo, Sagyou bloqueado, opção ligada):
  `O Sagyou está bloqueado: as escritas voltam depois de desbloquear (no PC ou pelo celular, aba PC). Leituras funcionam.`
- Texto do token suspenso: `Acesso externo cortado pelo celular.`
- Prazo do `authorize-remote`: `60 * 60_000` (Worker `REMOTE_REQUEST_TTL_MS` e core
  `MAX_TTL_MS['authorize-remote']`).
- Convite: erro `totp required` → `Cadastre o autenticador em Configurações → Sincronização para parear aparelhos.`;
  outro 401 → `Código do autenticador inválido.`; campo vazio →
  `Digite o código do autenticador.`; 429 → texto atual do core.
- `cut-access` ignora `suspendedUntil` e nunca chama `refused()`; `restore-access` conta
  como `unlock`.
- Encerrar servidor: `taskkill.exe /PID <pid> /T /F` pelo `systemExe` (caminho absoluto),
  nunca um executável achado no PATH.
- Nunca logar o código do autenticador, o token, o resumo do cartão ou argumentos.
- Versões: desktop `1.6.0` → `1.7.0`; celular `0.3.0` → `0.4.0`, `versionCode` `300` →
  `400`.

## Decisões do plano (checagem do construtor, 2026-11-07)

1. **Gerar novo token ou revogar não desfaz o corte** (decisão do construtor). O corte é do
   acesso: um token novo nasce suspenso enquanto `accessCutAt` não for `null`. No PC, quem
   está na frente usa **Restaurar acesso** (Task 12), que já existe sem o autenticador.
2. **O encerramento dos servidores tem timer próprio no main** (decisão do construtor): a
   cada 30 s, enquanto `accessCutAt !== null`, independente do Controle remoto estar
   ligado, do sync e do heartbeat. Começa no `whenReady` se o corte já estava gravado.
3. **Precedência das recusas no broker, só em `tools/call`** (`initialize`/`tools/list`
   continuam respondendo): corte ativo → `Acesso externo cortado pelo celular.`; senão
   `locking` → `MCP_LOCKED_MESSAGE` (leitura e escrita); bloqueado sem a opção →
   `MCP_LOCKED_MESSAGE`; bloqueado com a opção → leitura passa, escrita recebe
   `EXTERNAL_LOCKED_WRITE_MESSAGE`. Uma função pura decide: `externalRefusal({ cut, locked,
   locking, allowWhileLocked, kind }): string | null` (substitui `externalBlockedByLock`).
4. **Os cartões externos moram num módulo testável**, `modules/agent/mcp-external-cards.ts`
   (`createExternalCards`), com `park`, `denyAll()` e `count()`; o main chama `denyAll` ao
   bloquear, ao cortar, ao gerar e ao revogar o token.
5. **`cut-access` tem caminho próprio no serviço remoto**, antes da contagem: assinatura,
   prazo ou nonce inválidos são ignorados (log `ignored`), nunca `refused()`; a suspensão
   não o barra. `restore-access` sem a marca do Worker responde `reason: 'factor'` (novo
   em `ResultReason`) e conta; com o acesso não cortado, responde ok sem efeito.
6. **Encerrar inclui o processo-pai** (o `cmd`/`powershell` da tarefa de logon cuja linha
   tem `remote-control`), excluindo só o PowerShell da própria busca (`$_.ProcessId -ne
   $PID`). A tarefa de logon pode reiniciá-lo; o timer de 30 s o encerra de novo.
7. **`InboxMessage.factor` ausente = `false`** (Worker antigo); entra na Task 7, junto da
   rota que o preenche.
8. **Celular em `waiting-pc` de antes da atualização (sem `remoteRequestedAt`) não mostra o
   aviso de expirado**; **Cancelar pedido** continua lá.
9. **Celular 0.3 pedindo "Estou longe do PC" a um PC 1.7** é recusado (prazo de 24 h >
   1 h): aceito, porque os apps e o Worker sobem juntos (README da Task 14).
10. **`/invites` é rota de ação no `request()` do engine**: um 401 nela vira
    `SyncHttpError` (como `/totp/*` e `*/revoke`), nunca `SyncAuthError`, para um código
    errado não desconectar o aparelho.

## Foco de Review

1. **`remote-control.json` existente sem `accessCutAt`** → lê como `null` (acesso normal);
   valor não numérico também `null`. Testado na Task 5.
2. **Escrita externa que estava na fila quando o Sagyou bloqueia** → rejeitada com "O
   Sagyou foi bloqueado.", sem chegar ao renderer; com a opção ligada, nenhuma escrita
   passa o `protectDataIpc`. Testado nas Tasks 3 (`McpWriteQueue.rejectQueued` +
   `dataIpcAllowed`) e 4.
3. **Cartão externo pendente quando o acesso é cortado, o token revogado/trocado ou o
   Sagyou bloqueia** → resolvido como recusado e fechado no PC e no celular. Testado na
   Task 2 (`createExternalCards.denyAll`).
4. **Restaurar enviado pela rota comum (sem fator)** → recusado e conta para a suspensão;
   só a marca do Worker + assinatura de um controle restaura. Testado nas Tasks 6 e 7.
5. **App antigo (desktop 1.6 / celular 0.3) gerando convite com o Worker novo** → recebe
   erro, não gera convite sem fator; um código errado não desconecta o aparelho. E o
   celular 0.4 com um PC 1.6 (que descarta `cut-access`) → "O PC não respondeu." Testado
   nas Tasks 9 e 8.

### Task 1: Cartão no token externo (política)
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external-policy.ts` (sai
`LEGACY_CARD_WRITES` do caminho externo) · Teste
`apps/desktop/src/main/__tests__/mcp-external.test.ts` (onde os testes de
`externalApproval` estão hoje)
**Interfaces:** Produz `externalApproval(runId, name): boolean` (nova regra) e
`EXTERNAL_SESSION_NAME = 'Acesso externo'`.
- [ ] Passo 1: troque os testes de `externalApproval`: `external`+`delete_project` → true;
  `external`+`create_transaction` → true; `external`+`create_financial_table` → true;
  `external`+`update_task` → false; `external`+`save_memory` → false;
  `external`+`criar_task` → false; `abc`+`save_memory` → true (Fleet inalterado).
- [ ] Passo 2: push. Esperado: FALHA (hoje externo é sempre false).
- [ ] Passo 3: `externalApproval` = externo → `MCP_APPROVAL_REQUIRED.has(name)`; Fleet como
  hoje. Atualize o comentário (spec 2026-11-07).
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): escritas arriscadas voltam a pedir cartão`

### Task 2: Cartões do token externo no main (PC + celular)
**Arquivos:** Criar `apps/desktop/src/main/modules/agent/mcp-external-cards.ts`; Modificar
`apps/desktop/src/main/index.ts` (`requestMcpWriteApproval`, `remoteCards.maps`,
`pendingCards`, `refuseRunWritesForLock`, `onTokenChanged`),
`apps/desktop/src/main/handlers/mcp-external.ts`, `apps/desktop/src/preload/index.ts` ·
Teste criar `apps/desktop/src/main/__tests__/mcp-external-cards.test.ts`;
`mcp-external-handlers.test.ts`
**Interfaces:** Consome `EXTERNAL_SESSION_NAME`, `createRemoteCards`. Produz
`createExternalCards({ park: RemoteCards['park'], send }): { pending: Map; request(name,
args, resumo): Promise<boolean>; denyAll(): void; count(): number }`; IPC
`mcp-external:approve-request` (main→renderer, `{ id, resumo, expiresAt, name }`),
`mcp-external:approve-response` (renderer→main, `(id, approved) => boolean`), fecha por
`ai:code-agent:approval-closed`. Preload: `mcpExternal.onApproveRequest(cb)`,
`mcpExternal.answer(id, approved)`, `mcpExternal.onApprovalClosed(cb)`.
- [ ] Passo 1: testes em `mcp-external-cards.test.ts` (com um `createRemoteCards` real e
  um `service` falso): (a) `request` manda `sendCard` com `session: 'Acesso externo'` e
  `tool` sem `mcp:`, e `count()` = 1; (b) `answer(id, true)` de `createRemoteCards` resolve
  true e manda `approval-closed`; (c) `denyAll()` resolve false todos os pendentes, zera
  `count()` e fecha cada um no celular (`closeCard`); (d) prazo de 5 min (timers falsos) →
  false. Em `mcp-external-handlers.test.ts`: `mcp-external:approve-response` com id
  desconhecido → false.
- [ ] Passo 2: push. Esperado: FALHA (módulo não existe).
- [ ] Passo 3: implemente; no `index.ts`, `requestMcpWriteApproval` externo recusa se
  `!isMcpRunLive` ou `isAppLocked()` ou corte ativo, senão `externalCards.request`;
  `maps()` inclui `externalCards.pending`; `pendingCards()` soma `count()`; `denyAll()` em
  `refuseRunWritesForLock`, no `onTokenChanged` e no corte (Task 6). Log `mcp`/`approval`.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): cartões no PC e no celular`

### Task 3: Sagyou bloqueado = só leitura (main)
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external-lock.ts`
(sai `createLockedSaveGate`; `externalBlockedByLock` vira `externalRefusal`; nova
`dataIpcAllowed(unlocked: boolean, channel: string): boolean`, hoje só `unlocked`),
`apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (dep `isLocked` →
`lockRefusal?: (runId, kind) => string | null`), `apps/desktop/src/main/index.ts`
(`protectDataIpc` usa `dataIpcAllowed`; `withExternalLockedSave` removido;
`isMcpWriteLive` externo = `isMcpRunLive && !isAppLocked() && !corte`;
`refuseRunWritesForLock` sempre rejeita a fila externa),
`apps/desktop/src/main/modules/agent/mcp-external-policy.ts` (textos) · Teste
`mcp-external-lock.test.ts` (troca os testes do portão), `mcp-external-broker.test.ts`,
`sagyou-mcp.test.ts`, `mcp-write-queue.test.ts`
**Interfaces:** Produz `EXTERNAL_LOCKED_WRITE_MESSAGE`, `EXTERNAL_CUT_MESSAGE` (textos das
Restrições) e `externalRefusal({ cut, locked, locking, allowWhileLocked, kind }): string |
null` com a precedência da decisão 3.
- [ ] Passo 1: testes: `externalRefusal` — os 8 casos da decisão 3 (corte vence lock;
  locking → `MCP_LOCKED_MESSAGE` nos dois kinds; bloqueado sem opção → `MCP_LOCKED_MESSAGE`;
  bloqueado com opção: leitura → null, escrita → `EXTERNAL_LOCKED_WRITE_MESSAGE`;
  desbloqueado → null). `dataIpcAllowed(false, 'store:save') === false`. Broker: externo
  bloqueado com opção, `list_projects` responde e `create_task` recebe o texto novo;
  `tools/list` responde com o corte ativo; Fleet bloqueado sempre `MCP_LOCKED_MESSAGE`.
  Fila: `rejectQueued('external', 'O Sagyou foi bloqueado.')` rejeita a escrita externa
  que espera a vez sem chamar o executor.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente; log `external_locked_call` só para leitura servida bloqueada.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): bloqueado só leitura`

### Task 4: Renderer sem escrita bloqueada
**Arquivos:** Modificar `apps/desktop/src/renderer/src/services/mcpActions.ts`,
`apps/desktop/src/renderer/src/types/mcp-actions.ts`,
`apps/desktop/src/main/modules/agent/mcp-write-types.ts` (sai `lockedExternal`),
`apps/desktop/src/renderer/src/App.tsx` (handler de `store:mcp:create-task`,
`mcpWriteBlocked` sem o parâmetro), `apps/desktop/src/preload/index.ts` (tipo do
create-task), `McpTaskRequest` em `main/index.ts`; `prepareMcpAction`/`applyMcpAction`
perdem o desvio ·
Teste `apps/desktop/src/renderer/src/__tests__/services/mcpActions.test.ts`
- [ ] Passo 1: troque os testes de `lockedExternal` por: com `isDataLocked()` true, toda
  ação `apply` responde a recusa de bloqueio de hoje e `storage.save` não é chamado,
  qualquer que seja o payload (inclusive um `lockedExternal: true` legado).
- [ ] Passo 2: push. Esperado: FALHA (hoje `lockedExternal` aplica).
- [ ] Passo 3: remova o campo e o desvio; o texto "O Sagyou abriu bloqueado…" sai.
- [ ] Passo 4: push. Esperado: PASSA (inclui o teste que compara as listas de tipos).
- [ ] Passo 5: commit `refactor(mcp-externo): renderer não escreve com o Sagyou bloqueado`

### Task 5: Estado de corte e encerrar servidores
**Arquivos:** Modificar `apps/desktop/src/main/modules/remote/remote-config.ts`
(`accessCutAt: number | null`, normalizado na leitura), `apps/desktop/src/main/modules/remote/rc-servers.ts`
(`killRemoteControlServers`) · Teste `apps/desktop/src/main/__tests__/remote-config.test.ts`,
`rc-servers.test.ts`
**Interfaces:** Produz `killRemoteControlServers(exec: ExecText, platform?, env?): Promise<number>`
(quantidade encerrada; 0 fora do Windows ou em erro) e `RemoteConfig.accessCutAt`.
- [ ] Passo 1: testes: arquivo sem o campo → `null`; `"x"` → `null`; `123` → `123`;
  `defaultRemoteConfig().accessCutAt === null`. `killRemoteControlServers` com `exec`
  falso: lista `ProcessId` das linhas com `remote-control`, chama `taskkill.exe` com
  `['/PID', '<pid>', '/T', '/F']` por processo, caminho de `systemExe`; ignora PIDs não
  numéricos; erro do PowerShell → 0, log `remote`/`rc_kill_failed`; `linux` → 0 sem chamar.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: PowerShell `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'remote-control' -and $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`
  (decisão 6: o pai da tarefa de logon também sai; só o próprio PowerShell fica fora).
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(controle-remoto): estado de corte e encerrar servidores`

### Task 6: Cortar e restaurar no PC (serviço remoto)
**Arquivos:** Modificar `packages/core/src/control/messages.ts` (`cut-access`,
`restore-access`, `MAX_TTL_MS` de 1 min; `PcStatus.accessCutAt: number | null`, ausente →
null no parse), `packages/core/src/control/bodies.ts` (`ResultReason` ganha `'factor'`),
`apps/desktop/src/main/modules/remote/remote-service.ts` (caminho próprio do `cut-access`
antes de `controllerRequest`; caso `restore-access`; deps `cutAccess()`, `restoreAccess()`,
`accessCutAt()`), `apps/desktop/src/main/index.ts` (deps: grava `accessCutAt`,
`mcpWriteQueue.rejectQueued('external', …)`, `externalCards.denyAll()`,
`appLock.lock('remote')`; timer próprio de 30 s da decisão 2 chamando
`killRemoteControlServers`; o broker usa `externalRefusal` com `cut`) · Teste
`remote-service.test.ts`, `packages/core/src/control/__tests__/messages.test.ts`
**Interfaces:** Consome `killRemoteControlServers`, `accessCutAt`, `externalRefusal`.
Produz no heartbeat `accessCutAt`. Antes da Task 7, `restore-access` chega sempre com
`factor` ausente = `false` (decisão 7), então só o teste com mensagem montada à mão
restaura.
- [ ] Passo 1: testes: `cut-access` válido → `cutAccess` chamado, resposta ok, heartbeat
  com `accessCutAt`; com `suspendedUntil` no futuro → ainda corta; repetido (já cortado) →
  ok sem chamar de novo; assinatura inválida, vencido ou nonce repetido → ignorado, sem
  resposta de recusa contada e `failures` igual; `restore-access` com `factor: false` →
  `reason: 'factor'` e `failures` +1; com `factor: true` e suspensão ativa → `suspended`;
  com `factor: true` → `restoreAccess`, `accessCutAt` = null; com o acesso não cortado →
  ok sem efeito. `parsePcStatus` sem `accessCutAt` → null.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente; `cutAccess` é idempotente; log `remote`/`cut`, `remote`/`restore`,
  `remote`/`rc_killed` `{ count }`.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(controle-remoto): cortar e restaurar acesso no PC`

### Task 7: Rota do Worker para restaurar com fator
**Arquivos:** Modificar `sync-server/schema.sql` (`control_factor_checked`),
`sync-server/src/control-routes.ts` (`POST /control/restore`; `inbox` devolve `factor`),
a interface do banco do Worker e a implementação em memória dos testes,
`packages/core/src/control/client.ts` (`restore(factor, env): Promise<void>`;
`InboxMessage.factor: boolean`, ausente na resposta = `false`) · Teste
`sync-server/src/__tests__/control-routes.test.ts`, `packages/core/src/control/__tests__/client.test.ts`
- [ ] Passo 1: testes: `/control/restore` de quem não é `controller` → 403; sem
  `x-totp-code` → 401 `factor required` sem contar; código errado → 401 e conta; certo →
  mensagem na caixa do PC e o `inbox` do PC devolve `factor: true` só para ela; mensagens
  de `/control/send` → `factor: false`; a marca some quando a mensagem é buscada ou expira.
  Client: cabeçalhos `x-key-proof` + `x-totp-code`, `ttlMs` ≤ 60 000.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente com `requireProofAndFactor`, como `/roles/remote`.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync-server): restaurar acesso com o autenticador`

### Task 8: Celular — Cortar e Restaurar na aba PC
**Arquivos:** Modificar `apps/mobile/src/remote/store.ts` (`cutAccess()`,
`restoreAccess(factor)`), `apps/mobile/src/remote/texts.ts`,
`apps/mobile/src/screens/PcScreen.tsx` · Teste `apps/mobile/src/remote/__tests__/store.test.ts`,
`apps/mobile/src/screens/__tests__/PcScreen.test.tsx`, `a11y.test.tsx`
- [ ] Passo 1: testes: `cutAccess` manda `cut-access` assinado depois de `authenticate()`;
  sem resposta em 60 s → erro `O PC não respondeu. Forçar o desligamento pelo ESP32?`;
  status com `accessCutAt` → faixa `Acesso cortado em HH:MM.` e botão **Restaurar acesso**
  no lugar de **Cortar acesso**; `restoreAccess('')` não envia; `restoreAccess('123456')`
  chama `client.restore`; erro `factor` → `Código do autenticador inválido.`; `locked` →
  `Muitas tentativas. Tente de novo em 15 minutos.`; confirmação do corte com o texto da
  spec; botões com rótulo e 48 dp.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente; o código digitado é limpo após o envio; **Cortar acesso**
  variante `danger`, visível sempre que há sinal de vida. Espera do resultado: depois de
  `sendToPc('cut-access')`, `deps.setTimer` de 60 s; se o nonce ainda estiver em
  `requests` quando disparar, remove-o e mostra o erro; um `result` que chega antes limpa
  o timer (`deps.clearTimer`).
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): cortar e restaurar acesso pelo celular`

### Task 9: Convite com o autenticador (Worker + core)
**Arquivos:** Modificar `sync-server/src/routes.ts` (`invitesRoute`),
`packages/core/src/sync/engine.ts` (`createInvite(factor: SyncSecondFactor)` na interface
e na implementação; `/invites` entra na lista de rotas de ação do `request()`, decisão 10),
`apps/mobile/src/sync/invite.ts` (tipo do `engine` aceito por `fetchInvite`) · Teste
`sync-server/src/__tests__/routes.test.ts` e `helpers.ts` (os convites existentes passam a
cadastrar TOTP antes), `apps/desktop/src/main/__tests__/sync-engine.test.ts` (onde estão os
testes do engine; o Worker falso confere `x-totp-code` em `/invites`; as chamadas de
`createInvite()` ganham um fator), `apps/mobile/src/screens/__tests__/PairDeviceScreen.test.tsx`
(mock com o argumento)
- [ ] Passo 1: testes: Worker — grupo sem TOTP confirmado → 401 `totp required`, nenhum
  convite gravado; com TOTP e sem código → 401 `factor required`; código errado → 401 e
  conta; certo → 200 com `expiresAt`; código reserva certo → 200 e o reserva é gasto.
  Core — `createInvite({ totp: '' })` → `Digite o código do autenticador.` sem chamar a
  rede; manda `x-totp-code`; mapeia `totp required` e outros 401 para os textos das
  Restrições; um 401 em `/invites` **não** desconecta (status segue `active`, nenhum
  `forget`).
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: Worker: carrega o auth; `!auth.totpConfirmed` → 401 `totp required`; senão
  `requireFactor`. Core: mapeamento antes do `userError`.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): convite exige o código do autenticador`

### Task 10: Telas do convite (desktop e celular)
**Arquivos:** Modificar `apps/desktop/src/main/handlers/sync.ts` (`sync:invite` recebe o
fator, mesmo `factorOf`), `apps/desktop/src/preload/index.ts` (`sync.invite(totp)`),
`apps/desktop/src/renderer/src/components/settings/SyncSettings.tsx`,
`apps/mobile/src/sync/invite.ts` (`fetchInvite(engine, totp)`),
`apps/mobile/src/screens/PairDeviceScreen.tsx` · Teste `SyncSettings.test.tsx`,
`apps/mobile/src/screens/__tests__/PairDeviceScreen.test.tsx`, `a11y.test.tsx`
- [ ] Passo 1: testes: o botão de gerar fica desligado com o campo vazio; o campo tem
  rótulo `Código do autenticador` e ajuda `Ou um código reserva.`; erro do engine aparece
  como está; depois de gerar, o campo é limpo; no celular o QR só aparece depois do código.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente (sagyou-ui; campo do design system no celular, `Field` com
  `error`).
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): pedir o autenticador ao parear`

### Task 11: Pedido "Estou longe do PC" por 1 h
**Arquivos:** Modificar `sync-server/src/control-routes.ts` (`REMOTE_REQUEST_TTL_MS`),
`packages/core/src/control/messages.ts` (`MAX_TTL_MS['authorize-remote']`),
`apps/mobile/src/remote/keys.ts` (`remoteRequestedAt`), `apps/mobile/src/remote/store.ts`,
`PcScreen`/`ControlSetupScreen.tsx` · Teste `control-routes.test.ts`, `messages.test.ts`,
`store.test.ts`
- [ ] Passo 1: testes: a mensagem de `/roles/remote` expira em `now + 3 600 000`; envelope
  `authorize-remote` com `expiresAt` 2 h à frente → malformado; no celular, `waiting-pc` com
  `remoteRequestedAt` há mais de 1 h → `O pedido expirou. Ligue o PC e peça de novo.` e
  **Pedir de novo** (volta para `none` e apaga as chaves); `forget` apaga `remoteRequestedAt`;
  `waiting-pc` sem `remoteRequestedAt` (pedido de antes da atualização) → sem aviso
  (decisão 8).
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(controle-remoto): pedido à distância vale 1 hora`

### Task 12: Telas do desktop — diálogo, Acesso externo, Controle remoto
**Arquivos:** Criar `apps/desktop/src/renderer/src/components/modals/ExternalApprovalDialog.tsx`
(montado em `App.tsx`, `ModalBase`); Modificar
`apps/desktop/src/renderer/src/components/settings/McpExternalSettings.tsx`,
o componente da seção Controle remoto, `apps/desktop/src/main/handlers/remote.ts`
(`remote:restore-access` → `restoreAccess()`; `RemoteStatusView.accessCutAt`), menu da
bandeja (`buildTrayMenu`: linha desabilitada `Acesso cortado pelo celular`) · Teste
`ExternalApprovalDialog.test.tsx`, `McpExternalSettings.test.tsx`, `remote-handlers.test.ts`,
`tray-menu.test.ts`
- [ ] Passo 1: testes: diálogo abre num `approve-request` com título `Aprovar ação do
  acesso externo`, o resumo e a contagem; Aprovar → `answer(id, true)`; fecha num
  `approval-closed` do mesmo id; dois pedidos → fila, um de cada vez. McpExternalSettings:
  interruptor `Ler com o Sagyou bloqueado` + texto da spec; aviso de cartão; com
  `accessCutAt`, faixa `Acesso cortado pelo celular em <data>.` e **Restaurar acesso**.
  Handler `remote:restore-access` limpa `accessCutAt` e funciona com o Controle remoto
  desligado. As duas telas leem `accessCutAt` de `remote:status` (`RemoteStatusView`) e do
  evento de status que já existe; `mcp-external:status` não muda.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: implemente (sagyou-ui, `UI_DESIGN.md`).
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): diálogo de aprovação e tela de acesso cortado`

### Task 13: Guia "Como funciona"
**Arquivos:** Modificar `apps/desktop/src/renderer/src/guide/content.ts`,
`apps/desktop/src/renderer/src/guide/sync-content.ts`, `packages/core/src/sync/guide.ts` ·
Teste `content.test.ts`, `sync-content.test.ts`, `packages/core/src/sync/__tests__/guide.test.ts`
- [ ] Passo 1: testes: o artigo do acesso externo contém `pede aprovação` e
  `Ler com o Sagyou bloqueado`, e não contém `sem pedir aprovação` nem
  `Funcionar com o Sagyou bloqueado`; o do controle remoto contém `Cortar acesso` e
  `Restaurar acesso`; os de pareamento contêm `código do autenticador`; a linha "Perdeu…" do
  celular cita `Cortar acesso`.
- [ ] Passo 2: push. Esperado: FALHA.
- [ ] Passo 3: reescreva os artigos.
- [ ] Passo 4: push. Esperado: PASSA.
- [ ] Passo 5: commit `docs(guia): cartões, só leitura, cortar acesso e convite com autenticador`

### Task 14: Fechamento
- [ ] Suíte completa, typecheck e lint no CI (agente `sagyou-test-runner` lê o resultado).
- [ ] Versões: `apps/desktop/package.json` 1.7.0; `apps/mobile/app.json` 0.4.0 /
  `versionCode` 400 (+ `package.json`/lock como `app-config.test.ts` exige).
- [ ] `CLAUDE.md`, `GUIDE.md`, `README.md`: MCP externo com cartão e só leitura bloqueado,
  portão do `store:save` removido, IPC `mcp-external:approve-*` e `remote:restore-access`,
  `accessCutAt` na tabela do `userData`, rota `/control/restore` e tabela D1 nova, convite com
  fator (README: rodar o `schema.sql` de novo e reimplantar o Worker junto com os apps).
- [ ] Documento de segurança `docs/seguranca/2026-11-04-ameacas-acesso-remoto.md`: seção
  "Decisões de 2026-11-07" (itens 1–8, M5, M6, dívida de selar a senha).
- [ ] Verificação no app com Luis (`npm run dev` + APK da branch, que precisa do environment
  liberado para a branch ou de uma tag de teste): cartão externo aprovado no celular e no
  PC; bloqueado só lê; Cortar acesso encerra um `claude remote-control` de teste e ele não
  volta; Restaurar com o autenticador; convite pede o código nos dois apps.
- [ ] `/sagyou-review` com `sagyou-security-reviewer` e `sagyou-ui-reviewer` → `/sagyou-pr`.
