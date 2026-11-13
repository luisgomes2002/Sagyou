# Plano de implementação: Celular — aprovações, notificações e feedback do PC

Status: approved by Luis on 2026-11-13
Spec: docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md
Branch: feature/mobile-aprovacoes-notificacoes

**Objetivo:** o celular ganha o sino com a tela Notificações (cartões + histórico), 11 tipos de push em 3 canais do Android e feedback por etapas na aba PC.

**Arquitetura:**
- `packages/core/src/control/notify.ts` é a fonte única dos códigos, das categorias, dos textos e do destino do toque. O Worker, que não depende do core, mantém uma cópia mínima (códigos, texto, canal) pinada por um teste que a compara com o core.
- O PC dispara os pushes por `remote-service` (uma mensagem `status` assinada com `notify`, como o `ready` de hoje). O `rc-manager` ganha dois ganchos (`onReady`, `onFailed`) e o `index.ts` liga `session-done`, o desligamento e esses ganchos.
- O `pc-sem-sinal` nasce no Worker: o heartbeat leva o bit em claro `watch`, a tabela `pc_watch` guarda o bit e a hora do aviso, e um agendamento de 5 min manda o push.
- O celular guarda o histórico em `prefs` (`notifications.history`), recebe e abre pelo `PushBridge`, e mostra tudo na tela `Notificacoes`. Os cartões saem da aba PC.

## Restrições Globais

- **Testes:** não rodam no PC (pedido do Luis). Cada task faz commit de teste + código, push e lê o resultado no CI do PR (rascunho aberto na Task 1). Typecheck e lint locais são permitidos. O firmware não muda.
- **Spec:** `docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md`, com a emenda de `session-waiting` (ver "Decisões do construtor", item 1).
- **Códigos finais (11):** `ready`, `shutdown-failed`, `server-ready`, `server-failed`, `pc-silent` (canal `pc`); `approval`, `session-done` (canal `sessions`); `suspended`, `access-cut`, `device-paired`, `device-revoked` (canal `security`).
- **Textos fixos (idênticos no Worker e no core):**
  - `ready` "PC pronto."; `shutdown-failed` "O PC não foi desligado."; `approval` "Aprovação pendente no Sagyou.";
  - `server-ready` "Servidor de Remote Control ligado."; `server-failed` "O servidor de Remote Control não subiu ou caiu."; `pc-silent` "O PC parou de responder.";
  - `session-done` "Uma sessão de código terminou."; `suspended` "Controle remoto suspenso por tentativas recusadas."; `access-cut` "Acesso remoto cortado."; `device-paired` "Um aparelho foi pareado ao seu sync."; `device-revoked` "Um aparelho do seu sync foi revogado.".
- **Canais Android:** ids `pc`, `sessions`, `security`; nomes "PC e servidores", "Sessões de código", "Segurança". O push leva `data.open = 'pc'` (sempre), `data.code` e `android.notification.channel_id`.
- **Destino do toque:** `approval` → tela `Notificacoes`; todos os outros → aba PC.
- **Histórico:** pref `notifications.history`, JSON `[{ id, code, at, read, text? }]`, no máximo 100 entradas e 30 dias, mais nova primeiro, chave de duplicidade = `id` (identificador da notificação do Android) **ou** mesmo `code` com diferença de `at` menor que 60 s (a notificação da barra e a do toque podem chegar com ids diferentes). `text` só existe para `code: 'unknown'` (≤ 200 caracteres, do corpo da própria notificação). Nunca conteúdo de cartão.
- **Entrada de aprovação no histórico:** mostra "Responder acima" enquanto houver algum cartão válido na tela e "Expirou" quando não houver nenhum.
- **Limites do PC:** `session-done` 1 por sessão; `suspended` 1 por suspensão; `server-failed` 1 por servidor até ele voltar a `running`; `server-ready` só para o celular que pediu, e só origem `phone` (um reinício é origem `autostart`); `pc-silent` 1 por queda.
- **PC sem sinal:** limite 10 min (`SILENT_MS = 600_000`) sobre `control_status.at`; agendamento `*/5 * * * *`. PC antigo (sem `watch` no corpo) grava `watch = 0`: o Worker nunca emite `pc-silent` por ele.
- **Aba PC (limites):** Ligar PC 300 000 ms; Desligar PC, Ligar servidor e Desligar servidor 60 000 ms; "Concluído" some em 3 000 ms.
- **Textos de etapa:** "Enviando pedido…", "Pedido enviado. Aguardando o PC…", "Ligando o PC… pode levar alguns minutos.", "O PC não respondeu. Tente de novo.", concluídos "PC ligado." / "Desligamento iniciado." / "Servidor <nome> ligado." / "Servidor <nome> desligado.".
- **Tela:** "Notificações", "Aprovações pendentes", "Histórico", "Nenhuma notificação ainda.", "Limpar histórico", aviso na aba PC "N aprovações pendentes" com botão "Ver" (singular: "1 aprovação pendente"), rótulo do sino "Notificações" e, com cartões, "Notificações, N aprovações pendentes".
- **Celular:** alvos de 48 dp, cores só de `theme.ts`, componentes de `ui.tsx`, ícones só de `components/icons.ts`; `a11y.test.tsx` ganha a tela `Notificacoes` (entrada **no fim** de `SCREENS`); `useReducedMotion` troca o indicador por texto. `Alert.alert` continua nos botões de hoje (o modal único é outra spec).
- **Core sem Node** (`no-node.test.ts`). Sem log de conteúdo: o PC loga só `code`, contagens e ids.
- **Versões (conferir a `main` na Task 14):** celular MINOR 0.9.0 → 0.10.0 (`versionCode` 1000, pinado por `app-config.test.ts`); desktop MINOR 1.12.0 → 1.13.0; Worker: atualizar junto (README).

## Decisões do construtor (da checagem do plano)

1. **`session-waiting` sai da spec (emenda no item 16).** `pendingQuestions` do Fleet (`apps/desktop/src/main/index.ts`) só é lido, apagado e limpo: nada o preenche, e as sessões abrem em branco no CLI (sem cartão de pergunta). O gatilho descrito na spec não existe. O plano constrói 11 códigos; a emenda da spec (tirar a linha de `session-waiting` e o texto) entra no commit `docs(...): plan`.
2. **`pc_watch` não guarda a hora do heartbeat**: reaproveita `control_status.at`. Colunas: `id` (=1), `watch`, `notified_at`.
3. **`watch` ausente = 0**, e `putStatus` zera `notified_at` a cada heartbeat.
4. **Quem manda `watch=false`:** o heartbeat calcula `watch = deps.shutdownAt() === null`, então um desligamento agendado mantém `false` em todos os heartbeats seguintes e `abort-shutdown` volta a `true`; além disso, `refreshLoop` ao desativar um laço que rodava (sync pausado, controle desligado) dispara `void announceOffline()` (não espera), e o `before-quit` espera até 2 s dentro da sequência assíncrona que já existe (ver Task 6). Queda de energia e travamento não mandam: é o caso que o aviso cobre.
   - **"Forçar pelo ESP32":** o Worker não avisa se o último comando de energia foi `shutdown` com `at` ≥ `control_status.at − 60 s` (a consulta `silentPc` olha `power_commands`).
   - **Suspensão/hibernação do Windows** e rede caída no PC: aceitos como "PC parou de responder" (é o que o celular vê).
5. **`server-ready` e `server-failed` do pedido do celular vão só ao celular que pediu** (`serverRequests: Map<projectId, { controllerId, at }>` no `remote-service`, preenchido quando `startServer` devolve `ok`, expira em 10 min). `server-failed` por queda depois de pronto vai a todos os controladores.
6. **`start-failed` imediato não gera push** (o celular recebe a recusa com o motivo na própria resposta).
7. **`device-paired/revoked`:** base em memória (`knownDevices: Map<id, revoked> | null`); a primeira verificação só cria a base. Aparelho novo já revogado não notifica.
8. **`NotifyCode` continua exportado de `client.ts`** (reexport do `notify.ts`) para não mexer nos imports existentes.
9. **O sino lê a inbox uma vez** ao voltar ao primeiro plano e ao receber push com o app aberto, por um método novo `useRemote.refreshOnce()` que chama o `refresh()` que já existe, sem mudar o comportamento dele, e retorna logo se `polling` já roda.
10. **Canais criados em `registerChannels()`** chamada pelo `PushBridge` quando `controls` é verdadeiro; a linha de Ajustes abre `android.settings.CHANNEL_NOTIFICATION_SETTINGS` por `Linking.sendIntent`, e `Linking.openSettings()` se falhar.
11. **Ciclo de vida da ação na aba PC:**
    - Enquanto houver `action` em `sending` ou `waiting`, os botões Ligar/Desligar/Bloquear etc. da tela ficam desabilitados e o da própria ação continua renderizado (desabilitado, com indicador), mesmo que o estado do PC já tenha mudado (`booting`, `shutting-down`); `run` recusa uma nova ação nesse período.
    - Quando `power()` volta sem enviar (biometria cancelada, sem chave do ESP32), a ação é descartada (`null`) e o erro de hoje vale.
    - `observeAction` roda em `loadPcState` (todo ciclo de polling e `refreshOnce`); ao voltar à aba depois do limite, a conclusão observada vence o tempo esgotado.
    - Concluído: `wake` → `ready` **ou** `rc-down` (PC de pé); `shutdown` → `shutting-down` ou `off`.
12. **Contador do sino:** o próprio `NotificationBell` roda um relógio de 1 s só enquanto houver cartões (`setInterval` com limpeza) e conta os de `expiresAt > agora`.
13. **Dedup do histórico por código e tempo** (Restrições Globais) e verificação no aparelho (Task 14, passo 3) de que `request.identifier` e `data.code` chegam iguais na barra e no toque.
14. **`serverRequests` vazam até 10 min** quando o pedido cai em um servidor que já estava subindo ou rodando (`startServer` devolve `ok` sem passar por `onReady`); aceito, a entrada expira e é sobrescrita por um novo pedido.
15. **`before-quit`:** o `announceOffline` entra na sequência assíncrona já existente (a que para os cronômetros e espera até 3 s), em paralelo e com teto de 2 s; o implementador localiza o ramo e não cria um segundo `preventDefault`.
16. **Emendas da spec feitas neste commit** (o Luis aprova junto com o plano): sai `session-waiting`; `start-failed` imediato não gera push; `pc_watch` sem `last_heartbeat_at` e `putStatus` sem o 501; formato exato do histórico (`unknown`, `text`); texto "Responder acima"/"Expirou" por existência de cartão válido.

## Foco de Review

1. **PC desligado de propósito ou sync pausado nunca dispara `pc-silent`.** Esperado: desligar pelo celular, sair do Sagyou, instalar atualização e desativar o controle mandam `watch=false`; PC antigo grava 0. Testado nas Tasks 3, 5 e 6.
2. **Nenhum push duplicado ou em rajada.** Esperado: reinício automático de servidor não gera `server-ready`; `server-failed` uma vez até voltar a `running`; `server-ready` só para quem pediu; `session-done` não sai quando o usuário cancelou no PC (`run.abort`). Testado nas Tasks 5 e 6.
3. **Segredo e dado persistido no celular.** Esperado: o histórico guarda só `id`, `code`, `at`, `read` (e `text` de código desconhecido); sem resumo de cartão; o wipe/"Desconectar" apaga a pref e zera o store em memória; um valor corrompido em `notifications.history` lê como lista vazia sem derrubar o app. Testado na Task 7.
4. **Compatibilidade entre versões.** Esperado: Worker antigo com PC novo (400 `invalid notify`, `watch` ignorado) não derruba o ciclo do PC; push sem `data.code` vira entrada genérica; `code` desconhecido nunca quebra o app; app antigo ignora `code`. Testado nas Tasks 2, 5 (g3) e 8.
5. **Cartões expirados e contagem do sino.** Esperado: um cartão que expira some da tela e do contador no próximo relógio; Aprovar/Recusar desabilitados com o cartão expirado ou `busy`; a aba PC deixa de renderizar cartões mas mostra o aviso com o mesmo contador. Testado nas Tasks 11 e 12.

### Task 1: Core — códigos, categorias e textos de notificação
**Arquivos:** Criar `packages/core/src/control/notify.ts`; Modificar `packages/core/src/control/client.ts` (reexporta `NotifyCode`); Teste `packages/core/src/control/__tests__/notify.test.ts`.
**Interfaces:** Produz:
```ts
export const NOTIFY_CODES = ['ready','shutdown-failed','server-ready','server-failed','pc-silent','approval','session-done','suspended','access-cut','device-paired','device-revoked'] as const
export type NotifyCode = (typeof NOTIFY_CODES)[number]
export type NotifyCategory = 'pc' | 'sessions' | 'security'
export const NOTIFY_CATEGORY: Record<NotifyCode, NotifyCategory>
export const NOTIFY_CATEGORY_LABEL: Record<NotifyCategory, string> // "PC e servidores" | "Sessões de código" | "Segurança"
export const NOTIFICATION_TEXT: Record<NotifyCode, string>
export const NOTIFICATION_FALLBACK = 'Notificação do Sagyou'
export function isNotifyCode(value: unknown): value is NotifyCode
export function notifyTarget(code: NotifyCode | null): 'pc' | 'notifications' // approval → 'notifications'
```
- [ ] Passo 1: teste: os 11 códigos, cada um com categoria e texto exato (tabela das Restrições Globais); `isNotifyCode('x')` falso; `notifyTarget('approval') === 'notifications'`, os outros e `null` → `'pc'`; `client.ts` ainda exporta `NotifyCode`.
- [ ] Passo 2: abrir o PR rascunho e empurrar; esperado FALHA no CI: o módulo não existe.
- [ ] Passo 3: implementar `notify.ts`; `client.ts` troca a declaração por `export type { NotifyCode } from './notify'`.
- [ ] Passo 4: CI do PR. Esperado: PASSA (typecheck do desktop, celular e core).
- [ ] Passo 5: commit `feat(core): códigos, categorias e textos de notificação`

### Task 2: Worker — códigos novos, `data.code` e canal no push
**Arquivos:** Modificar `sync-server/src/control-routes.ts` (`NotifyCode`, `NOTIFY_CODES`), `sync-server/src/push.ts` (`PUSH_TEXT`, `PUSH_CHANNEL`, payload); Teste `sync-server/src/__tests__/push.test.ts`, `control-routes.test.ts`.
**Interfaces:** Consome `NOTIFY_CODES`, `NOTIFICATION_TEXT`, `NOTIFY_CATEGORY` do core (só no teste). Produz `PUSH_TEXT: Record<NotifyCode, string>` e `PUSH_CHANNEL: Record<NotifyCode, 'pc'|'sessions'|'security'>`.
- [ ] Passo 1: testes: (a) `PUSH_TEXT` e `PUSH_CHANNEL` iguais ao core para cada código (importando `../../../packages/core/src/control/notify`); (b) `sendPush(..., 'approval')` envia `data: { open: 'pc', code: 'approval' }` e `android.notification.channel_id: 'sessions'`, `notification.body` = texto; (c) `/control/send` do PC com `notify: 'server-failed'` guarda e dispara `deps.notify`; um código inventado → 400 `invalid notify`; de um celular com `notify` → 403 (como hoje).
- [ ] Passo 2: CI. Esperado: FALHA porque os códigos/canais não existem.
- [ ] Passo 3: ampliar as duas tabelas e o payload (`data: { open: 'pc', code }`, `android: { priority: 'high', notification: { channel_id } }`).
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(sync-server): códigos de push novos com canal Android`

### Task 3: Worker — `pc_watch`, bit `watch` e aviso agendado
**Arquivos:** Modificar `sync-server/schema.sql`, `sync-server/src/control-db.ts` (interface `ControlDb`, `D1ControlDb`, o banco em memória de teste), `sync-server/src/control-routes.ts` (`putStatus`), `sync-server/src/index.ts` (`scheduled`), `sync-server/wrangler.toml`; Criar `sync-server/src/watchdog.ts`; Teste `sync-server/src/__tests__/watchdog.test.ts`, `control-routes.test.ts`, `control-d1.test.ts`.
**Interfaces:** Produz:
```ts
// ControlDb
putWatch(watch: boolean, now: number): Promise<void>   // upsert id=1, zera notified_at
silentPc(now: number, silentMs: number): Promise<{ pc: string; controllers: string[] } | null> // watch=1, notified_at NULL, control_status.at < now - silentMs, status.from_device = papel pc, e o último comando de energia NÃO é shutdown com at >= control_status.at - 60_000
markSilentNotified(now: number): Promise<void>
// watchdog.ts
export const SILENT_MS = 600_000
export async function runWatchdog(control: ControlDb, notify: (ids: string[], code: NotifyCode) => Promise<void>, now: number): Promise<'sent' | 'none'>
```
`PUT /control/status` aceita `watch?: boolean` (qualquer outro tipo → 400 `invalid watch`); ausente grava `watch=false`.
- [ ] Passo 1: testes: (a) heartbeat `watch:true` e `at` há 11 min → `runWatchdog` envia `pc-silent` aos controladores com token e marca; segunda chamada → `'none'`; novo heartbeat limpa a marca e permite um novo aviso; (b) `watch:false` e `at` antigo → `'none'`; (c) corpo sem `watch` (PC antigo) → grava 0, `'none'`; (d) heartbeat há 9 min → `'none'`; (e) o dono do status não é mais o PC → `'none'`; (e2) último comando de energia `shutdown` emitido 30 s depois do último heartbeat → `'none'`, e um `shutdown` de 2 h antes não suprime; (f) `watch: 'x'` → 400; (g) D1 sem a tabela `pc_watch` (erro `no such table`) → `putStatus` continua respondendo 200 e o `runWatchdog` devolve `'none'` sem lançar.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: `CREATE TABLE IF NOT EXISTS pc_watch (id INTEGER PRIMARY KEY CHECK (id = 1), watch INTEGER NOT NULL, notified_at INTEGER)`; `index.ts` exporta `scheduled(event, env, ctx)` que monta `D1ControlDb` e `runWatchdog(control, notify, Date.now())` dentro de `ctx.waitUntil`; `wrangler.toml` ganha `[triggers]\ncrons = ["*/5 * * * *"]`. Erros de D1 sem a tabela são engolidos só nas funções de `pc_watch`.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(sync-server): aviso de PC sem sinal por agendamento`

### Task 4: Core — cliente envia `watch` no heartbeat
**Arquivos:** Modificar `packages/core/src/control/client.ts` (`putStatus` e a implementação HTTP); Teste `packages/core/src/control/__tests__/client.test.ts`.
**Interfaces:** `putStatus(env: SignedEnvelope, opts?: { watch?: boolean }): Promise<void>` — o corpo do `PUT /control/status` leva `watch` só quando `opts.watch` é boolean. Os chamadores atuais (`remote-service`, testes com fakes) continuam válidos.
- [ ] Passo 1: teste: `putStatus(env, { watch: true })` envia `{ msgId, ciphertext, watch: true }`; sem `opts` não inclui o campo.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(core): putStatus com o bit watch`

### Task 5: Desktop — `remote-service` dispara os pushes
**Arquivos:** Modificar `apps/desktop/src/main/modules/remote/remote-service.ts`; Teste `apps/desktop/src/main/__tests__/remote-service.test.ts` (ou o arquivo de testes existente do serviço; procurar `createRemoteService`).
**Interfaces:** Consome `NotifyCode` (Task 1) e `putStatus(env, { watch })` (Task 4). Produz em `RemoteService`:
```ts
notifyEvent(code: NotifyCode, only?: string): Promise<void>      // status assinado + notify, a `only` ou a todos os controladores
serverAccepted(projectId: string, controllerId: string): void    // preenchido internamente no case 'server-start'
serverReady(projectId: string): Promise<void>                    // → 'server-ready' ao celular que pediu, apaga a entrada
serverFailed(projectId: string, phase: 'start' | 'crash'): Promise<void> // 'start': ao que pediu; 'crash': a todos
announceOffline(): Promise<void>                                 // heartbeat com watch=false, tolera erro
```
O heartbeat chama `putStatus(env, { watch: deps.shutdownAt() === null })`; `refreshLoop`, ao desativar um laço que rodava, dispara `void announceOffline()`. `buildStatus(now)` é extraído do `heartbeat` e reaproveitado.
- [ ] Passo 1: testes (com o cliente falso do arquivo): (a) heartbeat envia `watch:true`; (b) `refreshLoop` ao desativar (sync pausado) e `announceOffline()` enviam `watch:false`; um `shutdown` aceito também; (c) 5ª recusa seguida que suspende → um `notifyEvent('suspended')` para os controladores, e a 6ª não repete; (d) `cut-access` aceito → `'access-cut'` a todos, depois da resposta; (e) `checkDevices`: a 1ª chamada cria a base sem notificar; aparelho novo → `device-paired`; aparelho conhecido que passa a revogado → `device-revoked`; aparelho novo já revogado → nada; (f) `server-start` aceito de C1 e `serverReady` → `server-ready` só para C1, e uma 2ª chamada não manda; entrada com mais de 10 min não manda; (g) `serverFailed('start')` só ao que pediu e `('crash')` a todos; (g2) com `shutdownAt()` não nulo o heartbeat manda `watch:false`, e depois de `abort-shutdown` volta a `true`; (g3) `client.send` rejeitando com `ControlError` (Worker antigo, 400 `invalid notify`) não lança de `notifyEvent` nem para o ciclo; (h) o envelope enviado é `status` assinado e `notify` é o código; nenhum log contém corpo de cartão ou nome de projeto.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar. `notifyEvent` usa `deps.now()` e o mesmo `sign('status', …, STATUS_TTL_MS)` do `ready`; erros por `noteError`.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(remote): push de sessão, segurança e servidor pelo PC`

### Task 6: Desktop — `rc-manager` e `index.ts` ligam os gatilhos
**Arquivos:** Modificar `apps/desktop/src/main/modules/remote/rc-manager.ts` (`RcManagerDeps.onReady`, `onFailed`), `apps/desktop/src/main/index.ts` (montagem do manager, `finishExternal`, `before-quit`); Teste `apps/desktop/src/main/__tests__/rc-manager.test.ts`, e um teste pequeno do gancho de `session-done` extraído em função pura `shouldNotifySessionDone(run)` em `modules/remote/session-notify.ts` + `__tests__/session-notify.test.ts`.
**Interfaces:** `onReady?: (projectId: string, origin: RcOrigin) => void` (uma vez por execução, quando `readySeen` vira verdadeiro) e `onFailed?: (projectId: string, phase: 'start' | 'crash', origin: RcOrigin) => void` (`start`: PTY sai antes de `readySeen`; `crash`: sai depois de `readySeen` sem parada pedida; no máximo 1 por servidor até o próximo `readySeen`). O `index.ts` chama `remoteService.serverReady(projectId)` só quando `origin === 'phone'`, `serverFailed` para `start` só com origem `phone`, e `crash` sempre.
- [ ] Passo 1: testes: (a) `onReady` com origem `phone` uma vez; um reinício (`relaunch` troca a origem para `autostart`) chama `onReady('autostart')` e o `index` não envia; (b) PTY que sai antes do Ready com origem `phone` → `onFailed('start')`; (c) servidor que estava pronto e sai → `onFailed('crash')` uma vez, e o segundo exit seguido não repete até um novo Ready; (d) parada pelo usuário (`stop`), `stopAll('cut'|'quit')` e `end` não chamam `onFailed`; (e) `shouldNotifySessionDone`: falso com `run.abort`, verdadeiro com código 0 e com código ≠ 0.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar; `finishExternal` chama `void remoteService?.notifyEvent('session-done')` depois do arquivamento quando `shouldNotifySessionDone(run)`; o `announceOffline` entra na sequência assíncrona que já existe no `before-quit` (a que espera os cronômetros), em paralelo, com `Promise.race` de 2000 ms; sem segundo `preventDefault` (decisão 15).
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(remote): ganchos de servidor pronto/caiu e fim de sessão`

### Task 7: Celular — histórico de notificações (regras e store)
**Arquivos:** Criar `apps/mobile/src/notifications/history.ts`, `apps/mobile/src/notifications/store.ts`, `apps/mobile/src/notifications/format.ts`; Modificar `apps/mobile/src/bootstrap.ts` (carrega o store, zera no wipe); Teste `apps/mobile/src/notifications/__tests__/history.test.ts`, `store.test.ts`.
**Interfaces:** Produz:
```ts
export const HISTORY_PREF = 'notifications.history'; export const HISTORY_MAX = 100; export const HISTORY_DAYS = 30
export interface HistoryEntry { id: string; code: NotifyCode | 'unknown'; at: number; read: boolean; text?: string }
export function parseHistory(raw: string | null): HistoryEntry[]            // inválido → []
export function addEntry(list: HistoryEntry[], entry: HistoryEntry, now: number): HistoryEntry[] // dedup por id, poda 30 d, corta 100, mais nova primeiro
export function entryText(e: HistoryEntry): string                          // NOTIFICATION_TEXT, e.text ou NOTIFICATION_FALLBACK
export function historyTime(at: number, now: number): string               // "hoje 14:32" | "ontem 09:10" | "12/11 14:32", hora local
export const useNotifications: UseBoundStore<{ entries; unread; load(repo); add(entry); markAllRead(); clear(); reset() }>
```
- [ ] Passo 1: testes: ordem; dedup por `id` e por mesmo `code` com `at` a menos de 60 s (e dois `approval` com 61 s entre eles ficam separados); 101ª entrada derruba a mais velha; entrada de 31 dias some; valor corrompido, `null`, tipo errado e item com campo faltando → lista vazia/ignorado; `entryText` para os 11 códigos e para `unknown` com e sem `text` (corta em 200); `historyTime` nos três formatos; `store.add` persiste por `repo.writePref`; `reset()` zera a memória; o JSON salvo **não contém** nenhum texto de cartão (teste varre a string) e contém só as chaves `id|code|at|read|text`; wipe: depois do `wipeLocal` do runtime, a pref some e `useNotifications` está vazio.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar. O `onWiped` do bootstrap chama `useNotifications.getState().reset()`.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): histórico de notificações do aparelho`

### Task 8: Celular — recebimento do push (`push.ts`, `PushBridge`, canais)
**Arquivos:** Modificar `apps/mobile/src/remote/push.ts`, `apps/mobile/src/App.tsx` (`PushBridge`), `apps/mobile/jest.setup.js` (mock de `getPresentedNotificationsAsync`, `addNotificationReceivedListener`, `setNotificationChannelAsync`); Teste `apps/mobile/src/remote/__tests__/push.test.ts`, `apps/mobile/src/__tests__/App.test.tsx`.
**Interfaces:** Consome `isNotifyCode`, `notifyTarget` (Task 1), `useNotifications` (Task 7). Produz:
```ts
export function pushCode(notification: unknown): NotifyCode | null           // data.code válido
export function entryFromNotification(n: unknown, now: number): HistoryEntry | null // id = request.identifier; sem code → 'unknown' + text do corpo
export function createResponseGate(): (response: unknown) => { target: 'pc' | 'notifications'; code: NotifyCode | null } | null
export const CHANNELS: { id: NotifyCategory; name: string }[]
export async function registerChannels(api: { setNotificationChannelAsync(id: string, c: object): Promise<unknown> }): Promise<void>
```
`notificationTarget` continua devolvendo `'pc'` para `open: 'pc'`. O `PushBridge`: cria os canais (importância alta, `security` máxima); ao montar e ao voltar ao primeiro plano (`AppState`) lê `getPresentedNotificationsAsync()` e adiciona as ausentes; `addNotificationReceivedListener` adiciona e chama `useRemote.getState().refreshOnce()`; o toque adiciona e navega (`approval` → `Notificacoes`, os outros → aba PC).
- [ ] Passo 1: testes: `pushCode` válido/ausente/inventado; entrada com `code` e entrada genérica (corpo de 300 caracteres corta em 200; sem corpo → `NOTIFICATION_FALLBACK`); o gate de resposta devolve `notifications` para `approval`, `pc` para o resto e `pc` para o push antigo (`open: 'pc'` sem `code`), e `null` na 2ª vez do mesmo identificador; `registerChannels` cria os três ids; `App.test`: toque em `approval` navega para `Notificacoes`, toque em `ready` abre a aba PC, notificação já presente na barra entra no histórico uma vez só.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): receber e registrar notificações`

### Task 9: Celular — `refreshOnce()` e progresso de ações no store do controle
**Arquivos:** Criar `apps/mobile/src/remote/progress.ts`; Modificar `apps/mobile/src/remote/store.ts`, `apps/mobile/src/remote/texts.ts`; Teste `apps/mobile/src/remote/__tests__/progress.test.ts`, `store.test.ts`.
**Interfaces:** Produz:
```ts
export type ActionKind = 'wake' | 'shutdown' | 'server-start' | 'server-stop'
export interface ActionProgress { kind: ActionKind; projectId?: string; name?: string; step: 'sending' | 'waiting' | 'done' | 'failed'; startedAt: number; text: string }
export const ACTION_LIMIT_MS: Record<ActionKind, number>   // 300000 | 60000 | 60000 | 60000
export const DONE_VISIBLE_MS = 3000
export function observeAction(a: ActionProgress, view: PcView | null, status: PcStatus | null, now: number): ActionProgress
// RemoteStore ganha: action: ActionProgress | null; refreshOnce(): Promise<void>  // refresh() existente, ignorado se polling roda
```
Conclusão observada: `wake` → `view.state` `'ready'` ou `'rc-down'`; `shutdown` → `'shutting-down'` ou `'off'`; `server-start` → servidor com `state === 'running'`; `server-stop` → `'stopped'`. Esgotado o limite → `failed` com "O PC não respondeu. Tente de novo.". Recusa do PC mantém o `error` de hoje e zera `action`. `wake`, `shutdown`, `startServer`, `stopServer` passam a criar a ação (`sending` → `waiting` quando o envio devolve `ok`). `done` é removida por timer (`deps.setTimer`) em 3 s. `refreshOnce()` chama o `refresh()` que já existe (sem mudar o comportamento dele) e retorna logo se `polling` roda. `observeAction` é chamado em `loadPcState`. Enquanto a ação está em `sending`/`waiting`, `run` recusa outra (decisão 11); `power()` que volta sem enviar (biometria cancelada, sem chave do ESP32) descarta a ação.
- [ ] Passo 1: testes: `observeAction` nas 4 conclusões, no limite (299 999 ms ainda `waiting`, 300 000 `failed` para `wake`; 60 000 para os demais) e depois de `done`; no store: Ligar PC mostra `sending` e `waiting` com o texto "Ligando o PC… pode levar alguns minutos."; Ligar servidor com recusa `serverNotConfirmed` deixa `action` nulo e `error` igual ao de hoje; `done` some em 3 s; duas ações não coexistem (`busy`); `refreshOnce()` não roda em paralelo ao polling e não altera o `refresh()`; ação com `power()` cancelado por biometria fica nula; `wake` com `rc-down` conclui; ao voltar depois de 5 min com o PC `ready`, vence `done`, não `failed`; uma segunda ação durante `waiting` é recusada; `Cortar acesso` e "Forçar pelo ESP32" não mudam.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar; textos de etapa em `REMOTE_TEXT` (`sending`, `waiting`, `wakeWaiting`, `noAnswer`, e funções `doneText(kind, name?)`).
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): etapas de ligar e desligar o PC e os servidores`

### Task 10: Celular — `Button` com indicador e linha de etapa na aba PC
**Arquivos:** Modificar `apps/mobile/src/components/Button.tsx` (prop `loading?: boolean`), `apps/mobile/src/screens/PcScreen.tsx`; Criar `apps/mobile/src/components/ActionStatus.tsx`; Teste `apps/mobile/src/components/__tests__/Button.test.tsx` (existente ou novo), `apps/mobile/src/screens/__tests__/PcScreen.test.tsx`.
**Interfaces:** Consome `ActionProgress` (Task 9). `Button loading` desabilita, mostra `ActivityIndicator` (cor do texto do botão) e, com `useReducedMotion`, só o rótulo. `ActionStatus({ action })`: linha com `accessibilityLiveRegion="polite"`, cores `theme.muted` (andamento), `theme.green` (concluído), `theme.red` (erro); para servidor aparece dentro da linha do servidor, para PC logo abaixo dos botões.
- [ ] Passo 1: testes: com `action` do tipo `wake` em `waiting` e o estado já `booting`, o botão "Ligar" continua renderizado, desabilitado, com o indicador, e a linha mostra o texto exato; o mesmo para "Desligar" em `shutting-down`; os outros botões da tela ficam desabilitados; `server-start` mostra a linha só no servidor certo; `done` mostra "Servidor X ligado." e some; `failed` reabilita o botão; reduced motion sem indicador; `a11y.test` continua passando (rótulo, 48 dp).
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): aba PC mostra o andamento das ações`

### Task 11: Celular — tela Notificações e cartões fora da aba PC
**Arquivos:** Criar `apps/mobile/src/screens/NotificationsScreen.tsx`, `apps/mobile/src/components/ApprovalCards.tsx`; Modificar `apps/mobile/src/screens/PcScreen.tsx` (sai a seção de cartões, entra o aviso), `apps/mobile/src/remote/texts.ts` (`CARDS_TITLE` passa para cá e `PcScreen` o reexporta), `apps/mobile/src/components/icons.ts` (`Bell`, um ícone por categoria); Teste `apps/mobile/src/screens/__tests__/NotificationsScreen.test.tsx`, `PcScreen.test.tsx`, `apps/mobile/src/__tests__/a11y.test.tsx`.
**Interfaces:** Consome `useRemote` (`cards`, `answer`, `startPolling`/`stopPolling`, `busy`), `useNotifications`, `entryText`, `historyTime`. Produz `NOTIFICATIONS_TITLE = 'Notificações'`, `export function NotificationsScreen()`. `ApprovalCards` é a lista de cartões de hoje (mesmos textos, `a11yLabel` "Aprovar: <resumo>"/"Recusar: <resumo>", relógio de 1 s) reaproveitada pela tela; a aba PC mostra `Card` "N aprovações pendentes" + botão "Ver" que navega para `Notificacoes`.
- [ ] Passo 1: testes: com 2 cartões válidos a seção "Aprovações pendentes" aparece com os dois e Aprovar chama `answer(id, true)`; cartão expirado desabilita os botões e mostra `CONTROL_TEXT.cardGone`, e some no próximo relógio; sem cartões a seção não existe; histórico em ordem com data e hora, não lidas em negrito, e `markAllRead` ao abrir; estado vazio "Nenhuma notificação ainda."; "Limpar histórico" apaga só o histórico (cartões ficam); a tela liga o polling de 5 s ao focar e desliga ao sair; toque numa entrada `ready` navega para a aba PC e numa `approval` não navega (rola até os cartões que já estão na tela); entrada `approval` mostra "Responder acima" com algum cartão válido e "Expirou" sem nenhum; sem conexão a tela mostra o aviso de conexão da aba PC; a aba PC não renderiza cartões, mostra "2 aprovações pendentes" com "Ver", e "1 aprovação pendente" no singular; `a11y.test` varre `Notificacoes`.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): tela de notificações com aprovações e histórico`

### Task 12: Celular — sino, rota e Ajustes
**Arquivos:** Criar `apps/mobile/src/components/NotificationBell.tsx`, `apps/mobile/src/notifications/channels-settings.ts`; Modificar `apps/mobile/src/App.tsx` (headerRight, `Stack.Screen name="Notificacoes"`, tipo `RootParams`), `apps/mobile/src/screens/SettingsScreen.tsx` (grupo "Notificações"); Teste `apps/mobile/src/__tests__/App.test.tsx`, `apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx`.
**Interfaces:** `NotificationBell({ onPress })`: aparece só com `authorized === 'yes'` e fora de `readOnly`; selo vermelho com o número de cartões não expirados (`Badge`), ponto quando `unread > 0` e não há cartões; rótulo "Notificações" ou "Notificações, N aprovações pendentes". `openChannelSettings(id: NotifyCategory): Promise<void>` usa `Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [{ key: 'android.provider.extra.APP_PACKAGE', value: pacote }, { key: 'android.provider.extra.CHANNEL_ID', value: id }])` e, em erro, `Linking.openSettings()`. O grupo de Ajustes (só autorizado e fora de `readOnly`) tem 3 linhas com `NOTIFY_CATEGORY_LABEL`.
- [ ] Passo 1: testes: o sino não existe sem autorização nem em `readOnly`; some com a desconexão; selo com 0 cartões não aparece, com 3 mostra "3"; só `unread` → ponto sem número; o toque navega para `Notificacoes`; um cartão que expira com a tela em outra aba (relógio de 1 s do sino) baixa o número sem polling e o relógio é limpo ao desmontar; o sino fica antes da lupa; Ajustes mostra as 3 linhas e cada uma chama `openChannelSettings` com o id certo; falha do intent cai em `openSettings`.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `feat(mobile): sino de notificações no cabeçalho`

### Task 13: Documentação, guia e README
**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md`, `README.md` (seção do Worker: aplicar `schema.sql` de novo, `wrangler deploy` para o agendamento, "atualize o Worker junto com os dois apps" nas versões 1.13/0.10), `apps/desktop/src/renderer/src/guide/content.ts` (o artigo de controle remoto cita os avisos, se ele os descreve hoje); Teste: o teste do guia existente (`guide/__tests__`) e o `app-config.test.ts`.
- [ ] Passo 1: ajustar o teste do guia que pina as referências do artigo alterado; esperado FALHA se o texto novo não bater.
- [ ] Passo 2: CI. FALHA.
- [ ] Passo 3: escrever os trechos: `CLAUDE.md` (apps/mobile: tela Notificações, histórico `notifications.history`, canais; `remote-service`: novos pushes, `watch`, `pc_watch`; Worker: agendamento), `GUIDE.md` (uma linha apontando para o `CLAUDE.md`) e README.
- [ ] Passo 4: CI. PASSA.
- [ ] Passo 5: commit `docs(mobile-aprovacoes-notificacoes): documentação`

### Task 14: Versão, suíte completa, verificação e PR
**Arquivos:** Modificar `apps/mobile/package.json`, `apps/mobile/app.json` (0.10.0, `versionCode` 1000), `apps/desktop/package.json` (1.13.0).
- [ ] Passo 1: conferir a `main` (`git fetch`) e ajustar as versões se outra feature já subiu; `app-config.test.ts` pina `versionCode = MAJOR×10000 + MINOR×100 + PATCH`.
- [ ] Passo 2: CI do PR com a suíte completa (typecheck, lint filtrado, testes, cobertura). Esperado: tudo verde.
- [ ] Passo 3: verificação no aparelho (APK novo: canais, push com app aberto/fechado, toque, Ajustes) e no PC (`npm run dev`: heartbeat, servidor ligado pelo celular, queda simulada): lista do que foi visto e do que não deu para ver (push real exige FCM e o APK).
- [ ] Passo 4: `sagyou-review` (reviewer, security-reviewer e ui-reviewer: toca IPC/`remote`, Worker e telas) e corrigir o que aparecer.
- [ ] Passo 5: PR pelo `sagyou-pr`; passos de deploy do Worker (`schema.sql` + `wrangler deploy`) na descrição; commit `chore(release): versões`.
