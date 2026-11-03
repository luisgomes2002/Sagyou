# Plano de implementação: Controle remoto do PC pelo app

Status: approved by Luis on 2026-11-03
Adendo aprovado por Luis em 2026-11-03: chave do PC antes de autorizar (`pc-key`) e
instalar a atualização pelo celular (Task 10b; botão na Task 16). Substitui a restrição
"Hold da atualização" abaixo.
Spec: docs/specs/2026-11-03-controle-remoto-app.md
Branch: feature/controle-remoto-app

**Objetivo:** pelo celular autorizado, ligar, ver o estado, desbloquear/bloquear, desligar o
PC de casa e aprovar os cartões do Fleet, inclusive trocando de celular longe de casa.

**Arquitetura:** um protocolo puro no `packages/core/src/control/` (cifra com subchave da
chave de sync, assinatura Ed25519, HMAC do ESP32, cálculo do estado) usado pelos dois apps;
rotas novas no Worker (caixa cifrada por destinatário, papéis, energia, push); no desktop um
serviço `modules/remote/` que manda o sinal de vida, lê a caixa e executa os pedidos pelos
caminhos que já existem (desbloqueio, `createAppLock`, flush do `update:install`, fila de
cartões); no celular um store `src/remote/`, a aba "PC" e as telas de autorização.

## Restrições Globais

- Verificação: **testes, typecheck e lint rodam só no CI** (regra de Luis). Cada task faz
  push da branch e confere `gh pr checks` / o run da branch; nada de `npm test` local.
- Core sem Node: nada de `crypto`, `Buffer`, `fs` em `packages/core` (`no-node.test.ts`).
  Toda dependência nova do core também entra em `apps/desktop/package.json` (teste existente).
- Nunca regenerar `src/__tests__/fixtures/sync-vectors.json`. O protocolo de sync não muda.
- Subchave nova: `hkdfSha256(syncKey, 'sagyou-control-v1', 32)`. AAD
  `sagyou-control|1|<de>|<para>|<msgId>`. XChaCha20-Poly1305, nonce de 24 bytes.
- Pedido assinado vale **60 s** (`expiraEm = emitidoEm + 60_000`); o PC aceita
  `emitidoEm` em `[agora − 90 s, agora + 30 s]` (decisão do construtor: folga de relógio).
- **5 pedidos recusados seguidos → suspensão de 15 min** do desbloqueio, desligar e
  autorização remota (`REMOTE_FAIL_LIMIT = 5`, `REMOTE_SUSPEND_MS = 15 * 60_000`).
- Sinal de vida a cada **30 s**; "sem sinal" a partir de **2 min**. Caixa do PC lida a cada
  **5 s**. ESP32 consulta a cada **10 s**. App consulta a cada **5 s** só com a aba "PC" em
  foco. Comando de energia vale **2 min**. "Ligando" dura até **5 min** sem ping.
- Pedido de autorização (local ou remoto) vale **10 min**. Cartão de aprovação: os mesmos
  `MCP_APPROVAL_TIMEOUT_MS` (5 min).
- Desligar: `shutdown /s /t 60 /c "Sagyou: desligando pelo celular"`; cancelar `shutdown /a`.
- Nunca logar: senha, chaves, assinatura, token do ESP32, token FCM, conteúdo de cartão.
  Área de log nova `remote` (eventos: `unlock`, `lock`, `shutdown`, `abort_shutdown`,
  `authorize`, `authorize_remote`, `revoke`, `refused` com `reason`, `suspended`).
- `remote-control.json` / `remote-control-dev.json`: fora do SQLite, do backup e do sync;
  modo 0600, `.tmp` + rename; entra em `wipeTargets`.
- Celular: chave privada do controle em `expo-secure-store` com `requireAuthentication: true`;
  chave pública do PC e chave do ESP32 no secure store sem biometria. Nunca em SQLite,
  prefs, Zustand persistido ou log.
- UI: `UI_DESIGN.md` + regras pessoais (sem cor com opacidade como preenchimento, sem
  brilho/neon/`animate-pulse`). Celular: só componentes de `ui.tsx`, ícones de `icons.ts`,
  48 dp, rótulos (`a11y.test.tsx`).
- Versões: desktop `1.5.0 → 1.6.0`; celular `0.2.0 → 0.3.0`, `versionCode 200 → 300`.
- **Contador do comando de energia = `at`** (ms do relógio do celular, decisão do construtor):
  o ESP32 executa só se o MAC confere, `at` > último `at` executado (flash),
  `|at − agora NTP| ≤ 5 min` e `exp > agora`. Cada recusa fica no estado assinado que o
  ESP32 informa (`lastResult: 'ok'|'mac'|'old'|'clock'|'expired'`), e o app mostra
  "O ESP32 recusou o comando: relógio do celular errado." / "O ESP32 recusou o comando."
- **Hold da atualização (revisto no adendo)**: o controle remoto não fica segurado por uma
  atualização pendente; o sinal de vida leva `updateVersion` e o celular pode pedir
  `install-update`. O sync de dados continua segurado como antes.

## Respostas à checagem do construtor

- **Id do PC antes de ser controle:** `GET /roles/pc` aberto a qualquer aparelho ativo devolve
  `{ pc: string | null }` (id opaco, sem conteúdo). A lista de controles só o `pc` lê
  (`GET /roles/controllers`). Tasks 3 e 5.
- **"Estou longe do PC" com o PC desligado:** o `authorize-remote` fica no Worker por
  **24 h** (exceção ao limite de 10 min, só para essa mensagem), então o PC confere a senha
  quando subir. Senha errada → o PC remove o papel do celular no Worker
  (`DELETE /roles/controllers/:id`) e responde `result {ok:false, reason:'wrong-password'}`;
  o celular volta para "Estou longe do PC" com "Senha do Sagyou incorreta." e pede tudo de
  novo. O papel de controle dado pelo Worker basta para **ligar** (chave do ESP32) antes de
  o PC conferir; desbloquear, desligar pelo Sagyou e cartões esperam o `authorized`.
- **Dois fatores na troca à distância:** `recover` (Task 14) e `/roles/remote` (Task 15)
  gastam um fator cada. A tela de "Estou longe do PC" diz "Use um código novo do
  autenticador ou outro código reserva (o anterior já foi usado para entrar)."
- **Chave do ESP32:** ao gerar (`remote:esp32:create`) o PC grava a chave cifrada local,
  faz `PUT /esp32-key` (selada com a subchave de controle, `to = 'esp32-key'`) e envia
  `esp32-key` a cada controle autorizado; ao autorizar (local ou remoto) envia `esp32-key`
  junto com `authorized`. Task 9/10.
- **Sync desligado ou pausado:** o serviço ouve `emitStatus` do engine; sync inativo,
  pausado ou `no-keychain` → `stop()`, `enabled` fica como está e a tela mostra "O controle
  remoto está parado: a sincronização não está ativa.". Volta sozinho quando o sync volta.
  Task 9/10.
- **Aparelho revogado no sync:** o serviço chama `engine.devices()` a cada 5 min e ao
  revogar pela tela de Sincronização; controle cujo id está revogado ou ausente sai do
  `remote-control.json`. Task 9.
- **"Ligando" depois de reabrir o app:** vem de `lastCommand` do `GET /power/state`
  (`{ cmd, at }` do último comando aceito pelo Worker), não da memória do celular. Task 2/13.
- **Estado do ESP32 forjado:** o app confere `powerStateMac`; estado sem MAC válido é
  tratado como ESP32 sem contato. Task 13.
- **Limpeza duplicada de controles:** só o Worker limpa em `/roles/remote`; o PC apenas
  atualiza o próprio `remote-control.json`.

## Foco de Review

1. **Pedido repetido ou velho** (o Worker ou alguém com a chave de sync reenviando um
   "desbloquear" capturado): recusado por nonce já visto (persistido em
   `seenNonces` até expirar, sobrevive a reinício) ou fora da janela; conta como erro.
   Testado na Task 9.
2. **Desbloqueio remoto com o Sagyou que abriu bloqueado**: o renderer carrega os dados uma
   vez (`loadData` só com `!isLoaded`), sem creditar cronômetros duas vezes; desbloquear de
   novo depois de um bloqueio remoto não recarrega. Testado nas Tasks 10 e 11.
3. **Desligar com flush falhando**: nada de `shutdown`; o celular recebe "Não foi possível
   salvar o Sagyou; o PC não foi desligado." e o push `shutdown-failed`. Testado na Task 10.
4. **Cartão respondido duas vezes / depois do prazo / por id inventado**: só a primeira
   resposta para um `id` pendente resolve; a outra tela fecha o cartão; um id desconhecido
   não faz nada e não conta como erro de assinatura se a assinatura for válida. Testado na
   Task 10.
5. **Dados existentes**: Worker com o `schema.sql` antigo (tabelas novas ausentes) responde
   `501 {error:'control not deployed'}` e o app mostra "Atualize o Worker para usar o
   controle remoto." em vez de quebrar o sync; o sync de hoje não muda; um wipe remoto apaga
   `remote-control.json`; trocar a biometria do Android invalida a chave do controle e o app
   mostra "A biometria do celular mudou. Autorize este celular de novo." Testado nas Tasks
   5, 7 e 13.

### Task 1: Core — criptografia do controle

**Arquivos:** Criar `packages/core/src/control/crypto.ts`; Teste
`packages/core/src/control/__tests__/crypto.test.ts`; Modificar `packages/core/package.json`,
`apps/desktop/package.json`, `apps/mobile/package.json`, `package-lock.json` (+`@noble/curves@^1.9`).
**Interfaces:** Produz:
- `controlKey(syncKey: Uint8Array): Uint8Array`
- `sealControl(key, from: string, to: string, msgId: string, plain: Uint8Array): string` /
  `openControl(key, from, to, msgId, sealed: string): Uint8Array` (lança `ControlDecryptError`)
- `newSigningKeys(): { privateKey: Uint8Array; publicKey: Uint8Array }`,
  `signBytes(priv, data): string` (base64url), `verifyBytes(pub, data, sig: string): boolean`
- `pairingCode(pubA: Uint8Array, pubB: Uint8Array): string` — 6 dígitos de
  `sha256(sort(pubA,pubB))`, igual nas duas ordens.
- `newEsp32Key(): Uint8Array` (32 bytes); `powerCommandMac(key, cmd, at, exp): string`
  (HMAC-SHA256 hex de `sagyou-power|1|<cmd>|<at>|<exp>`);
  `powerStateMac(key, pcPing: boolean, lastResult: string, at: number): string`
  (`sagyou-power-state|1|<1|0>|<lastResult>|<at>`).
- [ ] Passo 1: testes: seal/open ida e volta; open com outro `to`/`msgId`/chave lança
  `ControlDecryptError`; `controlKey` ≠ as chaves `enc`/`id` de `deriveKeys`; assinatura
  válida verifica e com 1 byte trocado não; `pairingCode(a,b) === pairingCode(b,a)` e tem
  `/^\d{6}$/`; MAC do comando com vetor fixo (chave `00…1f`, `wake`, `at=1000`,
  `exp=121000`) igual ao valor calculado à mão no teste e mudando com qualquer campo.
- [ ] Passo 2: push; esperado no CI: FALHA (módulo não existe).
- [ ] Passo 3: implementar com `@noble/curves/ed25519` e as funções de `sync/bytes.ts`.
- [ ] Passo 4: push; esperado: PASSA (inclusive `no-node.test.ts` e o teste de deps do core).
- [ ] Passo 5: commit `feat(core): criptografia do controle remoto`

### Task 2: Core — mensagens, pedidos assinados e estado do PC

**Arquivos:** Criar `packages/core/src/control/messages.ts`,
`packages/core/src/control/state.ts`, `packages/core/src/control/texts.ts`; Teste
`packages/core/src/control/__tests__/messages.test.ts`, `.../state.test.ts`.
**Interfaces:** Consome Task 1. Produz:
- `type ControlKind = 'authorize-request' | 'authorize-remote' | 'authorized' | 'revoked' |
  'unlock' | 'lock' | 'shutdown' | 'abort-shutdown' | 'esp32-key' | 'approval-card' |
  'approval-answer' | 'approval-closed' | 'result'`
- `interface SignedEnvelope { v: 1; kind: ControlKind; nonce: string; issuedAt: number;
  expiresAt: number; body: Record<string, unknown>; sig: string }` (assinatura sobre o JSON
  canônico sem `sig`, reaproveitando `canonicalJson` do core)
- `signEnvelope(priv, kind, body, now, ttlMs = 60_000): SignedEnvelope`
- `checkEnvelope(env, pub, now, seen: (nonce) => boolean):
  { ok: true } | { ok: false; reason: 'signature' | 'expired' | 'future' | 'replay' | 'shape' }`
- `interface PcStatus { v: 1; at: number; locked: boolean; servers: { name: string; up: boolean }[];
  pendingCards: number; shutdownAt: number | null; suspendedUntil: number | null }`
- `type PcState = 'ready' | 'rc-down' | 'waiting-sagyou' | 'booting' | 'shutting-down' | 'off'`
- `pcState(input: { now; status: PcStatus | null; power: { pcPing: boolean; at: number; lastPoll: number; verified: boolean } | null;
  lastCommand: { cmd: string; at: number } | null }): { state: PcState; esp32Offline: boolean; missing: string[] }`
- `texts.ts`: `PC_STATE_TEXT` e mensagens exatas da spec ("PC pronto.", "PC ligado, Remote
  Control fora do ar: <nomes>.", "Ligado, aguardando o Sagyou", "Ligando", "Desligando em M:SS",
  "Desligado", "ESP32 sem contato", "O ESP32 não respondeu.", "O PC recusou o pedido.",
  "Desbloqueio remoto suspenso até HH:MM.", "Este cartão já foi respondido ou expirou.",
  "Não foi possível salvar o Sagyou; o PC não foi desligado.", "Atualize o Worker para usar o
  controle remoto.", "Aguardando o PC concluir a autorização", "Celulares anteriores perderam o
  controle do PC. Revogue também o aparelho perdido na sincronização, apagando os dados dele.",
  "A biometria do celular mudou. Autorize este celular de novo.").
- [ ] Passo 1: testes de `checkEnvelope`: válido; `sig` trocada → `signature`; `expiresAt`
  passado → `expired`; `issuedAt = now + 31 s` → `future`; `issuedAt = now − 91 s` →
  `expired`; nonce visto → `replay`; `kind` desconhecido → `shape`. Testes de `pcState`, um
  por linha da tabela da spec, incluindo status de 1:59 (pronto) × 2:00 (sem sinal), ping
  sem status → `waiting-sagyou`, `lastCommand` `wake` há 4:59 sem ping → `booting`, há 5:00 → `off`, `verified: false` → `esp32Offline`,
  `shutdownAt` no futuro → `shutting-down`, `lastPoll` há 2:00 → `esp32Offline`, servidores
  parados listados em `missing` na ordem da lista.
- [ ] Passo 2: push; esperado: FALHA.
- [ ] Passo 3: implementar (funções puras, sem relógio interno).
- [ ] Passo 4: push; esperado: PASSA.
- [ ] Passo 5: commit `feat(core): mensagens e estado do controle remoto`

### Task 3: Core — cliente HTTP do controle

**Arquivos:** Criar `packages/core/src/control/client.ts`; Teste
`packages/core/src/control/__tests__/client.test.ts`.
**Interfaces:** Consome Tasks 1–2, `FetchLike`, `SyncConfig`, `keyProof`, `opaqueDeviceId`.
Produz `createControlClient(deps: { fetch: FetchLike; config: () => SyncConfig | null;
deviceId: () => string; now: () => number }): ControlClient` com:
`send(to, kind, env: SignedEnvelope, notify?: 'ready'|'approval'|'shutdown-failed')`,
`inbox(): Promise<{ from: string; msgId: string; env: SignedEnvelope }[]>` (decifra; uma
mensagem que não abre é descartada e devolvida em `dropped`),
`putStatus(env)`, `getStatus(): Promise<{ from; env } | null>`, `setPc(factor)`,
`addController(id)`, `removeController(id)`, `pcId(): Promise<string | null>`, `controllers(): Promise<string[]>`,
`remoteRole(factor, env)`, `putEsp32Key(sealed)`, `getEsp32Key(): Promise<string|null>`,
`createPowerToken(factor): Promise<string>`, `powerCommand(cmd, at, exp, mac)`,
`powerState(): Promise<{ pcPing; lastResult; at; mac; lastPoll; lastCommand: { cmd; at } | null } | null>`, `putPushToken(token)`.
Erros: `ControlError` com `code: 'offline' | 'unauthorized' | 'forbidden' | 'not-deployed' |
'factor' | 'locked' | 'gone'` (401→unauthorized, 403→forbidden, 501→not-deployed,
429→locked, 410→gone).
- [ ] Passo 1: testes com `fetch` falso: URLs, método, `Authorization: Bearer`, `x-key-proof`
  e `x-totp-code` só em `setPc`/`remoteRole`/`createPowerToken`; `send` cifra com AAD do
  par certo e `inbox` decifra; mensagem adulterada vai para `dropped`; cada status HTTP vira
  o `code` acima; rede falhando → `offline`.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(core): cliente do controle remoto`

### Task 4: Worker — tabelas e banco

**Arquivos:** Modificar `sync-server/schema.sql`, `sync-server/src/db.ts` (interface
`SyncDb`, `D1SyncDb`, e o banco em memória dos testes); Teste
`sync-server/src/__tests__/control-db.test.ts`.
**Interfaces:** Produz em `SyncDb`:
`getRoles(): Promise<{ pc: string | null; controllers: string[] }>`, `setPc(id, now)`,
`addController(id, now)`, `removeController(id)`, `clearControllers(except?: string)`,
`putMessage(m: { to; from; msgId; ciphertext; expiresAt; now }): Promise<boolean>` (false com
50 pendentes para o destinatário), `takeMessages(to, now): Promise<MessageRow[]>` (apaga ao
ler e descarta expiradas), `putStatus(from, ciphertext, now)`, `getStatus()`,
`putEsp32Key(cipher, now)`, `getEsp32Key()`, `setPowerToken(hash, now)`,
`powerTokenMatches(hash)`, `putPowerCommand(c)`, `takePowerCommand(now)`,
`putPowerState(s)`, `getPowerState()`, `putPushToken(id, token, now)`, `pushTokens(ids)`.
`revokeDevice` passa a apagar o papel e o token FCM do aparelho.
Tabelas (todas `CREATE TABLE IF NOT EXISTS`): `device_roles(id PRIMARY KEY, role CHECK IN
('pc','controller'), created_at)`, `control_messages(msg_id PRIMARY KEY, to_device, from_device,
ciphertext, expires_at, created_at)`, `control_status(id=1, from_device, ciphertext, at)`,
`esp32_key(id=1, cipher, at)`, `power_tokens(id=1, token_hash, created_at)`,
`power_commands(id=1, cmd, at, exp, mac, taken_at)`, `power_state(id=1, pc_ping, at, mac,
last_poll)`, `push_tokens(id PRIMARY KEY, token, at)`.
- [ ] Passo 1: testes no banco em memória: um só `pc` (setPc troca o anterior); controle
  removido some; `takeMessages` entrega uma vez e não devolve expiradas; 51ª mensagem
  recusada; `revokeDevice` remove papel e token FCM; `takePowerCommand` devolve null depois
  de expirar ou de já buscado.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(sync-server): tabelas do controle remoto`

### Task 5: Worker — rotas de controle e energia

**Arquivos:** Modificar `sync-server/src/routes.ts` (tabela `ROUTES`), `sync-server/src/index.ts`
(env `FCM_SERVICE_ACCOUNT` opcional); Teste `sync-server/src/__tests__/control-routes.test.ts`.
**Interfaces:** Consome Task 4, `authenticate`, `requireProof`, `checkFactor`/`requireFactor`.
Rotas e regras (corpo máx 64 KB nas `/control/*`):
- `POST /roles/pc` — prova + fator; quem chama vira `pc`, controles anteriores mantidos.
- `GET /roles/pc` — qualquer aparelho ativo; `{ pc }`. `GET /roles/controllers` — só o `pc`.
- `POST /roles/controllers` `{ id }` / `DELETE /roles/controllers/:id` — só o `pc`, com prova.
- `POST /roles/remote` `{ env }` — prova + fator; quem chama vira controle,
  `clearControllers(except = quem chama)`; guarda `env` como mensagem `authorize-remote`
  para o `pc` (**24 h**). Sem `pc` → 409 `{error:'no pc'}`.
- `POST /control/send` `{ to, msgId, ciphertext, ttlMs ≤ 600000, notify? }` — o `pc` envia a
  qualquer aparelho ativo; os demais só ao `pc`. `notify` só aceito vindo do `pc` e só com
  `'ready'|'approval'|'shutdown-failed'`.
- `GET /control/inbox` — mensagens do chamador.
- `PUT /control/status` (só `pc`) / `GET /control/status` (só controles).
- `PUT /esp32-key` (só `pc`) / `GET /esp32-key` (só controles).
- `POST /power-token` — só `pc`, prova + fator; devolve `{ token }` uma vez.
- `POST /power/command` `{ cmd ∈ wake|shutdown|abort-shutdown, at, exp ≤ at + 120000, mac }`
  — só controles. `GET /power/state` — só controles.
- `GET /power/next` / `POST /power/state` `{ pcPing, lastResult, at, mac }` — só `Authorization: Bearer
  <token do ESP32>`; atualiza `last_poll`. O Worker não confere o MAC (não tem a chave).
- Tabela ausente (D1 lança "no such table") → 501 `{ error: 'control not deployed' }`.
- [ ] Passo 1: testes: cada regra de papel com 403; token do ESP32 não acessa `/pull` nem
  `/control/*` (401); token de aparelho não acessa `/power/next` (401); aparelho revogado
  401; `/roles/remote` com fator errado conta no bloqueio de 5 erros e não mexe nos papéis;
  `/roles/remote` certo deixa só o novo controle; comando com `exp > at + 120000` → 400;
  `/power/next` devolve o comando uma vez; 501 com banco sem as tabelas; rotas de sync
  existentes continuam passando sem mudança.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(sync-server): rotas de controle remoto e energia`

### Task 6: Worker — push pelo FCM

**Arquivos:** Criar `sync-server/src/push.ts`; Modificar `routes.ts` (`/control/send` com
`notify`, `PUT /push/token`); Teste `sync-server/src/__tests__/push.test.ts`.
**Interfaces:** Produz `sendPush(deps: { serviceAccount?: string; fetch; now }, tokens: string[],
code: 'ready'|'approval'|'shutdown-failed'): Promise<void>` — JWT RS256 (`crypto.subtle`,
chave `pkcs8` da conta de serviço), troca em `https://oauth2.googleapis.com/token`, envia a
`https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`. Textos fixos:
`ready` → "PC pronto.", `approval` → "Aprovação pendente no Sagyou.", `shutdown-failed` →
"O PC não foi desligado."; `data: { open: 'pc' }`. Falha de push nunca falha o `send`
(`ctx.waitUntil` no `index.ts`). Sem `FCM_SERVICE_ACCOUNT` → não faz nada.
- [ ] Passo 1: testes com `fetch` falso: sem conta → zero chamadas; com conta (chave RSA
  gerada no teste) → corpo só com os textos fixos e o token; erro 500 do Google não muda a
  resposta da rota; `notify` vindo de um controle → 403.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(sync-server): notificações pelo FCM`

### Task 7: Desktop — arquivo `remote-control.json`

**Arquivos:** Criar `apps/desktop/src/main/modules/remote/remote-config.ts`; Modificar
`apps/desktop/src/main/modules/sync/wipe.ts`; Teste
`apps/desktop/src/main/__tests__/remote-config.test.ts`, `apps/desktop/src/main/__tests__/sync-engine.test.ts` (onde `wipeTargets` já é testado).
**Interfaces:** Consome `SafeStorageLike`. Produz
`interface RemoteConfig { enabled: boolean; pcKeys: { publicKey: string; privateCipher: string } | null;
controllers: { id: string; name: string; publicKey: string; since: string }[];
servers: string[]; esp32KeyCipher: string | null; failures: number; suspendedUntil: number | null;
seenNonces: { nonce: string; until: number }[] }`,
`loadRemoteConfig(dir, file, safe): RemoteConfig` (ausente/ilegível → padrão desligado),
`saveRemoteConfig(dir, file, config)`, `remoteConfigFileName(dev)`,
`pcPrivateKey(config, safe): Uint8Array | null`, `esp32Key(config, safe): Uint8Array | null`.
- [ ] Passo 1: testes (`@vitest-environment node`, dir temporário): ida e volta;
  JSON malformado → padrão; modo 0600 no POSIX; `seenNonces` vencidos podados ao salvar;
  `wipeTargets(false)` contém `remote-control.json` e `wipeTargets(true)` contém
  `remote-control-dev.json`.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): configuração local do controle remoto`

### Task 8: Desktop — detectar servidores de Remote Control

**Arquivos:** Criar `apps/desktop/src/main/modules/remote/rc-servers.ts`; Teste
`apps/desktop/src/main/__tests__/rc-servers.test.ts`.
**Interfaces:** Produz `matchServers(commandLines: string[], names: string[]):
{ name: string; up: boolean }[]` e `listCommandLines(exec): Promise<string[]>` (Windows:
`powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process |
Where-Object { $_.CommandLine -match 'remote-control' } | Select-Object -ExpandProperty
CommandLine"`; outra plataforma → `[]`; erro → `[]` e log `remote/rc_scan_failed`).
Regra: `up` quando há linha com `remote-control` e `--name "<nome>"` ou `--name <nome>`
(sem aspas, nome sem espaço), comparação exata sem diferenciar caixa.
- [ ] Passo 1: testes: `claude.exe remote-control --spawn worktree --name "Sagyou"` → Sagyou
  up; `node …\cli.js remote-control --name Murasaki` → up; `--name "Sagyou Beta"` não
  liga "Sagyou"; linha sem `remote-control` não conta; ordem de saída = ordem da lista.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): detectar servidores de Remote Control`

### Task 9: Desktop — serviço do controle remoto

**Arquivos:** Criar `apps/desktop/src/main/modules/remote/remote-service.ts`; Teste
`apps/desktop/src/main/__tests__/remote-service.test.ts`.
**Interfaces:** Consome Tasks 2, 3, 7, 8. Produz
`createRemoteService(deps: { client: ControlClient; config: () => RemoteConfig;
save: (c: RemoteConfig) => void; pcPrivateKey: () => Uint8Array | null; now; setTimer; clearTimer;
isLocked: () => boolean; verifyPassword: (p: string) => boolean;
unlock: () => void; lock: () => void; shutdown: () => Promise<'ok' | 'flush-failed'>;
abortShutdown: () => Promise<void>; shutdownAt: () => number | null;
servers: () => Promise<{ name; up }[]>; pendingCards: () => number;
answerCard: (id: string, approved: boolean) => boolean;
devices: () => Promise<{ id: string; revoked: boolean }[]>; esp32Key: () => Uint8Array | null; log }): RemoteService` com
`start()`, `stop()`, `tick()` (para testes), `pendingAuthorizations(): { id; name; code; expiresAt }[]`,
`authorize(id, password): 'ok' | 'wrong-password' | 'expired'`, `refuse(id)`,
`revokeController(id)`, `sendCard(card)`, `closeCard(id)`, `publishEsp32Key()`,
`syncStatusChanged(status: SyncStatus)`.
Regras:
- Ciclo: a cada 5 s `inbox()`; a cada 30 s `putStatus` com `PcStatus` assinado. O primeiro
  status "pronto" depois de iniciar manda `notify: 'ready'` a cada controle.
- Pedido de quem não é controle autorizado (exceto `authorize-request` e
  `authorize-remote`) → recusado `reason: 'unknown-controller'`.
- Recusa (`checkEnvelope` falhou ou controle desconhecido) incrementa `failures`; a 5ª grava
  `suspendedUntil = now + 15 min` e loga `suspended`; um pedido aceito zera `failures`.
  Suspenso: `unlock`, `shutdown`, `authorize-remote` respondem `result {ok:false,
  reason:'suspended', until}` sem executar; `lock` e respostas de cartão seguem valendo.
- `unlock` sem senha configurada ou já desbloqueado → `result {ok:true}` sem efeito.
- `authorize-remote`: senha errada conta como recusa; certa → adiciona o controle,
  remove os anteriores (`removeController` no Worker para cada um), envia `authorized`
  com a chave pública do PC e `esp32-key` se houver.
- `shutdown`: `'flush-failed'` → `result {ok:false, reason:'flush-failed'}` + `notify:
  'shutdown-failed'`.
- `approval-answer`: `answerCard` false (id não pendente) → `result {ok:false, reason:'gone'}`,
  sem contar erro.
- Nonces aceitos entram em `seenNonces` até `expiresAt`.
- [ ] Passo 1: testes com cliente, relógio e timers falsos cobrindo cada regra acima, mais:
  repetir o mesmo `unlock` → `replay` e `unlock` chamado uma vez; reiniciar o serviço com
  a mesma config e repetir → ainda `replay`; 5 recusas → suspenso e 6º `unlock` válido não
  desbloqueia; após 15 min desbloqueia; `authorize-request` cria pendência com o
  `pairingCode` e some depois de 10 min; `authorize-remote` com senha errada remove o
  papel no Worker e responde `wrong-password`; autorizar (local e remoto) envia
  `authorized` e `esp32-key`; status do sync inativo para o ciclo e ativo o retoma;
  `engine.devices()` sem o controle (ou revogado) o remove do arquivo.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): serviço do controle remoto no PC`

### Task 10: Desktop — ligar no app (main, IPC, preload)

**Arquivos:** Modificar `apps/desktop/src/main/index.ts`,
`apps/desktop/src/main/modules/security/app-lock.ts` (`LockReason` + `'remote'`),
`apps/desktop/src/main/modules/agent/mcp-approval.ts`, `apps/desktop/src/preload/index.ts`;
Criar `apps/desktop/src/main/handlers/remote.ts`, `apps/desktop/src/main/modules/remote/shutdown.ts`;
Teste `apps/desktop/src/main/__tests__/remote-handlers.test.ts`, `shutdown.test.ts`,
`handlers.test.ts` (existente), `mcp-approval.test.ts` (existente).
**Interfaces:** Consome Task 9. Produz:
- `shutdown.ts`: `createShutdown(deps: { flush: () => Promise<boolean>; stopRunTimers: () => Promise<void>;
  exec: (cmd: string, args: string[]) => Promise<void>; now }): { start(): Promise<'ok'|'flush-failed'>;
  abort(): Promise<void>; at(): number | null }` — `flush` reaproveita o caminho do
  `app:flush-before-install`; `at()` = início + 60 s.
- Desbloqueio remoto: mesma mutação do `security:unlock` aceito (`passwordUnlocked = true`,
  `refreshTrayMenu()`) e `mainWindow.webContents.send('security:remote-unlocked')`.
- Bloqueio remoto: `appLock.lock('remote')`.
- Cartões: `resolveMcpApproval(id, approved): boolean` extraído do handler
  `ai:code-agent:approve-response` (que passa a usá-lo); ao estacionar um cartão o serviço
  recebe `sendCard`; ao resolver (PC, celular ou prazo) `closeCard(id)` e
  `send('ai:code-agent:approval-closed', id)`.
- IPC (registrado depois de `protectDataIpc`): `remote:status`, `remote:enable(factor)`,
  `remote:disable`, `remote:authorizations`, `remote:authorize(id, password)`,
  `remote:refuse(id)`, `remote:revoke(controllerId)`, `remote:servers:set(names: string[])`,
  `remote:esp32:create(factor)` → `{ token, key }` uma vez (grava a chave cifrada e chama
  `publishEsp32Key()`); push main→renderer
  `remote:status-changed`. `remote:enable` recusa fora do Windows, sem senha ou sem sync
  ativo, com os textos "Só funciona no Windows.", "Configure a senha do Sagyou antes.",
  "Ative a sincronização antes.".
- [ ] Passo 1: testes: `createShutdown` com flush false não chama `exec`; com true chama
  `stopRunTimers` antes de `exec('shutdown', ['/s','/t','60','/c','Sagyou: desligando pelo celular'])`;
  `abort` chama `exec('shutdown', ['/a'])`. Handlers: cada texto de recusa do `remote:enable`;
  `remote:esp32:create` devolve token e chave uma vez e grava só a chave cifrada;
  o `fetch` embrulhado recusa `/control/*` com o hold ativo e deixa `/power/*` passar;
  `remote:servers:set` rejeita não-array e nomes com mais de 64 caracteres; desbloqueio
  remoto emite `security:remote-unlocked` e não chama `loadData`; um cartão resolvido pelo
  celular emite `approval-closed` e uma segunda resposta do PC não faz nada.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): controle remoto no processo main`

### Task 10b: Desktop — chave do PC e instalar atualização pelo celular (adendo)

**Arquivos:** Modificar `packages/core/src/control/messages.ts` (kinds `pc-key` e
`install-update`; `PcStatus.updateVersion: string | null`, opcional na leitura),
`modules/remote/remote-service.ts`, `handlers/update.ts` (devolve `install()` para reuso),
`main/index.ts`; remover `modules/remote/remote-fetch.ts`. Teste `remote-service.test.ts`,
`update-handlers.test.ts`, `messages.test.ts`, `remote-handlers.test.ts`.
Regras: `authorize-request` aceito → `pc-key { pcPublicKey }` ao celular;
`install-update` de controle autorizado, sujeito à suspensão; `'ok'` → `result ok`;
`'none'` (nada pronto) → `result {ok:false, reason:'no-update'}` sem contar erro;
`'failed'` → `result {ok:false, reason:'install-failed'}`.
- [ ] Passo 1: testes de cada regra; status com `updateVersion`.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): chave do PC e atualização pelo celular`

### Task 11: Desktop — tela Configurações → Controle remoto e renderer

**Arquivos:** Criar `apps/desktop/src/renderer/src/components/settings/RemoteControlSettings.tsx`;
Modificar `components/views/SettingsView.tsx` (seção `controle-remoto`, oitava, ícone de
`SECTION_ICONS`), `navigation.ts` (`SettingsSectionId`), `hooks/useAppLock.ts`
(`onRemoteUnlocked` → sai do `UnlockScreen`; `App.tsx` continua carregando só com
`!isLoaded`), `components/ai/fleet/useCodeAgentRuns.ts` (remove o cartão em
`approval-closed`); Teste `__tests__/components/RemoteControlSettings.test.tsx`,
`__tests__/hooks/useAppLock.test.tsx`, `__tests__/components/useCodeAgentRuns.test.tsx`,
`__tests__/guide/content.test.ts` (constante `SETTINGS_SECTIONS` da linha 23 recebe `controle-remoto`). Usar a skill `sagyou-ui`.
**Interfaces:** Consome os IPC da Task 10.
Textos: interruptor "Controlar este PC pelo celular" com "Ligar, desligar, desbloquear e
aprovar cartões do Fleet pelo celular autorizado. Pede o código do autenticador."; pedido
"<nome> quer controlar este PC — código <6 dígitos>" com **Autorizar** (campo de senha) e
**Recusar**; lista "Celulares autorizados" com **Revogar** (confirma "Revogar <nome>? Ele
deixa de controlar este PC na hora." e sugere "Gerar nova chave do ESP32"); "Servidores de
Remote Control" (adicionar por nome, sugestões dos projetos com pasta de código, estado
"Rodando"/"Parado"); "Token do ESP32" com **Gerar** / **Gerar novo** (pede o código do
autenticador; mostra token e chave uma vez com Copiar e "Cole os dois no secrets.h do
ESP32. Eles não aparecem de novo."). Suspenso: "Controle remoto suspenso até HH:MM por
pedidos recusados.".
- [ ] Passo 1: testes de cada estado e texto acima; senha errada mostra "Senha incorreta."
  e não fecha o pedido; token some ao sair da seção; `useAppLock` destrava com
  `remote-unlocked` sem chamar `loadData` quando já carregado; cartão some no Fleet com
  `approval-closed`.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(remote): tela de controle remoto nas configurações`

### Task 12: Guias — controle remoto e trocar de celular

**Arquivos:** Modificar `apps/desktop/src/renderer/src/guide/content.ts` (artigo
`controle-remoto`, alvo `{ view:'settings', section:'controle-remoto' }`),
`apps/desktop/src/renderer/src/guide/sync-content.ts` e `packages/core/src/sync/guide.ts`
(artigo `sync-trocar-celular` "Trocar de celular longe de casa" e linha "Perdeu o celular
autorizado → código de recuperação + senha do Worker + código reserva + senha do Sagyou" na
tabela de chaves); Teste `__tests__/guide/content.test.ts`, `__tests__/guide/sync-content.test.ts`,
`packages/core/src/sync/__tests__/guide.test.ts`, `apps/mobile/src/screens/__tests__/SyncGuide.test.tsx`.
- [ ] Passo 1: testes: os artigos existem, citam "Estou longe do PC", "Entrar com código de
  recuperação" e o que guardar fora do celular; o artigo de controle remoto diz que o
  comando do ESP32 é assinado e que o Worker não lê dados; continuam sem "chat"/"conversas".
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `docs(guia): controle remoto e trocar de celular`

### Task 13: Celular — chaves e store do controle

**Arquivos:** Criar `apps/mobile/src/remote/keys.ts`, `apps/mobile/src/remote/store.ts`;
Modificar `apps/mobile/src/sync/runtime.ts` (`wipeLocal` também apaga as chaves do
controle); Teste `apps/mobile/src/remote/__tests__/keys.test.ts`, `store.test.ts`,
`apps/mobile/src/data/__tests__/records.test.ts` (o teste que varre o SQLite em busca de segredos).
**Interfaces:** Consome Tasks 1–3. Produz:
- `keys.ts`: `createControllerKeys(secure)`: `ensure(): Promise<{ publicKey }>` (gera e grava
  com `requireAuthentication: true`), `sign(kind, body): Promise<SignedEnvelope>` (lê a chave
  — a biometria aparece aqui), `clear()`, `pcPublicKey()/setPcPublicKey()`,
  `esp32Key()/setEsp32Key()`. Chaves `sagyou.control.private`, `sagyou.control.pcpub`,
  `sagyou.control.esp32`. Leitura que falha por chave invalidada → `KeyInvalidatedError`.
- `store.ts` (Zustand, não persistido): `{ authorized: 'none' | 'pending' | 'waiting-pc' |
  'yes'; view: ReturnType<typeof pcState> | null; status; cards: Card[]; error: string | null;
  pairingCode: string | null }` e ações `requestAuthorization()`, `requestRemote(password,
  factor)`, `refresh()`, `startPolling()/stopPolling()` (5 s), `wake()`, `shutdown()`,
  `forceShutdown()`, `abortShutdown()`, `unlock()`, `lock()`, `answer(id, approved)`,
  `removeThisPhone()`. `wake/forceShutdown/abortShutdown` montam `at = Date.now()`,
  `exp = at + 120000` e o MAC com a chave do ESP32. Mensagens do PC com assinatura
  inválida são ignoradas.
- [ ] Passo 1: testes: secure store falso confere `requireAuthentication: true` só na
  privada; `KeyInvalidatedError` → `error` = "A biometria do celular mudou. Autorize este
  celular de novo." e `authorized = 'none'`; `wake` envia MAC conferível com
  `powerCommandMac`; card com assinatura de outra chave é ignorado; `answer` de cartão vencido
  mostra "Este cartão já foi respondido ou expirou."; 501 → "Atualize o Worker para usar o
  controle remoto."; nenhum segredo nas tabelas do SQLite nem nas prefs; `wipeLocal` apaga
  as três chaves.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(mobile): chaves e store do controle remoto`

### Task 14: Celular — entrar com código de recuperação

**Arquivos:** Modificar `apps/mobile/src/screens/PairScreen.tsx`; Teste
`apps/mobile/src/screens/__tests__/PairScreen.test.tsx`, `apps/mobile/src/__tests__/a11y.test.tsx`.
**Interfaces:** Consome `engine.recover(code, setupToken, deviceName, factor)`.
Opção **Entrar com código de recuperação**: campos "Código de recuperação" (multilinha,
colado), "Senha de configuração do Worker" (oculta), "Código do autenticador ou reserva";
botão **Entrar**. Erros com os textos que o desktop já usa para `sync:recover` (os mesmos
`SyncUserError`).
- [ ] Passo 1: testes: chama `recover` com os três valores e o nome do aparelho; erro de
  fator mostra a mensagem do `SyncUserError` e mantém os campos; nenhum valor vai para log
  ou prefs; acessibilidade (rótulos, 48 dp).
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(mobile): entrar com código de recuperação`

### Task 15: Celular — Ajustes → Controlar o PC

**Arquivos:** Criar `apps/mobile/src/screens/ControlSetupScreen.tsx`; Modificar `App.tsx`
(root stack `ControlarPC`, título "Controlar o PC"), `SettingsScreen.tsx` (linha
"Controlar o PC", escondida com `readOnly`); Teste `ControlSetupScreen.test.tsx`,
`SettingsScreen.test.tsx`, `a11y.test.tsx`.
Estados: sem autorização → **Pedir autorização** e **Estou longe do PC**; pendente →
"Compare este código com o do PC: 482 913" e "Aguardando o PC"; longe → campos "Senha do
Sagyou" e "Código do autenticador ou reserva", **Enviar**; depois "Aguardando o PC concluir a
autorização" (o aviso dos celulares anteriores aparece aqui com atalho para a lista de
aparelhos); autorizado → "Autorizado" e **Remover este celular**. `useLockState.hidden`
volta da tela e limpa os campos.
- [ ] Passo 1: testes de cada estado e texto; senha some do estado ao sair; botão Remover
  confirma e chama `removeThisPhone`.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(mobile): autorizar este celular a controlar o PC`

### Task 16: Celular — aba "PC"

**Arquivos:** Criar `apps/mobile/src/screens/PcScreen.tsx`; Modificar `App.tsx` (aba "PC",
só com `authorized === 'yes'`, `tabBarButtonTestID: 'tab-PC'`), `components/icons.ts`
(`TAB_ICONS.PC` = `Monitor`, ações `Power`, `PowerOff`, `Lock`, `LockOpen`);
Teste `PcScreen.test.tsx`, `a11y.test.tsx`.
Conteúdo: estado (ícone + texto de `PC_STATE_TEXT`), "Sagyou bloqueado"/"Sagyou
desbloqueado", servidores que faltam, linha "ESP32 sem contato" quando for o caso; botões
por estado: Desligado → **Ligar**; Pronto/RC fora/Aguardando → **Desligar**,
**Desbloquear** ou **Bloquear agora**; aguardando o Sagyou há ≥ 2 min com ping →
**Forçar pelo ESP32** com a confirmação exata da spec; Desligando → contagem e
**Cancelar**. Lista de cartões com contagem regressiva, **Aprovar**/**Recusar**. Polling só
com a aba em foco (`useFocusEffect`). Adendo: com `updateVersion`, "Atualização <versão>
pronta" e **Instalar atualização** (confirmação "Instalar a atualização agora? O Sagyou
salva tudo e reinicia."); falha mostra "Não foi possível instalar a atualização; o Sagyou
continua na versão atual.".
- [ ] Passo 1: testes: cada estado mostra os botões certos e nenhum outro; confirmação de
  forçar; cartão vencido desabilita os botões; polling para ao sair da aba; TalkBack lê o
  estado (`accessibilityLiveRegion`).
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(mobile): aba PC`

### Task 17: Celular — notificações

**Arquivos:** Modificar `apps/mobile/package.json` (`expo-notifications` via `npx expo
install`), `app.json` (plugin `expo-notifications`; `./plugins/withGoogleServices`), Criar
`apps/mobile/plugins/withGoogleServices.js` (copia `google-services.json` só se
`GOOGLE_SERVICES_JSON` existir), `apps/mobile/src/remote/push.ts`; Modificar
`.github/workflows/mobile-apk.yml` (secret `GOOGLE_SERVICES_JSON` escrito em arquivo antes do
build, nunca impresso); Teste `plugins/__tests__/withGoogleServices.test.js`,
`src/remote/__tests__/push.test.ts`, `release-config.test.ts`.
**Interfaces:** `registerPush(client)`: pede permissão, `getDevicePushTokenAsync()`,
`putPushToken`; tocar na notificação abre a aba "PC". Sem permissão, nada quebra.
- [ ] Passo 1: testes: plugin sem env não muda a config; com env grava o arquivo; push
  registra o token só com `authorized === 'yes'`; resposta com `open: 'pc'` navega para a aba.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(mobile): notificações do PC`

### Task 18: ESP32 simulado e contrato do firmware

**Arquivos:** Criar `sync-server/scripts/esp32-sim.mjs` (Node; `--url`, `--token`, `--key`,
`--ping on|off`; consulta `/power/next` a cada 10 s, confere o MAC e o prazo, imprime o
comando, envia `/power/state` assinado) e `docs/esp32-api.md` (rotas, formatos, MAC,
contador por `at` estritamente crescente guardado na flash, NTP, intervalo de 10 s,
`secrets.h`); Teste `sync-server/src/__tests__/esp32-sim.test.ts` (as funções de verificação
exportadas pelo script).
- [ ] Passo 1: testes: MAC certo e `at` novo → executa; `at` igual ou menor → ignora; MAC
  errado → ignora; `exp` passado → ignora.
- [ ] Passo 2–4: push FALHA → implementar → push PASSA.
- [ ] Passo 5: commit `feat(sync-server): ESP32 simulado e contrato do firmware`

### Task 19: Fechamento

- [ ] CI completo verde na branch (typecheck, lint do diff, testes, e2e).
- [ ] Verificação no app com Luis (`npm run dev` no Windows): ativar o modo controlado,
  autorizar o celular (APK pelo `mobile-apk.yml` da branch), ver "Pronto"/"Remote Control
  fora do ar", Bloquear agora e Desbloquear pela biometria, cartão do Fleet aprovado pelo
  celular, Desligar com Cancelar, Ligar com `esp32-sim.mjs`, "Estou longe do PC" com um
  segundo aparelho, push chegando com o app fechado.
- [ ] Worker: README com `wrangler d1 execute … --file=schema.sql` de novo,
  `wrangler secret put FCM_SERVICE_ACCOUNT` e o Firebase; a seção de comandos do guia
  espelhada à mão (o teste do guia fixa os literais).
- [ ] `CLAUDE.md`, `GUIDE.md`, `README.md`: `modules/remote/`, IPC `remote:*`,
  `security:remote-unlocked`, `ai:code-agent:approval-closed`, área de log `remote`, linha
  `remote-control.json` na tabela de `userData`, rotas do Worker, aba "PC" e
  `src/remote/` do celular, secret `GOOGLE_SERVICES_JSON`.
- [ ] Versões: desktop 1.6.0; celular 0.3.0 / `versionCode` 300.
- [ ] Tasks Montagem novas no Sagyou: "Criar projeto no Firebase" e o firmware (6.6) segue
  `docs/esp32-api.md`.
- [ ] `/sagyou-review` com `sagyou-security-reviewer` e `sagyou-ui-reviewer`, depois `/sagyou-pr`.
