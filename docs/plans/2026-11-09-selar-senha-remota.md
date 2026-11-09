# Plano de implementação: selar a senha do "Estou longe do PC"

Status: approved by Luis on 2026-11-09
Spec: docs/specs/2026-11-09-selar-senha-remota.md
Branch: feature/selar-senha-remota

**Objetivo:** a senha do `authorize-remote` passa a ir selada para a chave do PC, obtida pelo
Worker, e o PC recusa a senha sem selo.

**Arquitetura:** o core ganha o selo (Ed25519 → X25519, ECDH efêmero, HKDF, XChaCha20-Poly1305)
e o corpo novo. O Worker guarda a chave pública do PC numa tabela própria, que só o `pc`
atual escreve. O PC publica a chave e abre o selo; o celular busca, confere e sela.

## Restrições Globais

- Testes rodam **só no CI** (preferência do Luis): "rode" nos passos abaixo = push e `gh pr checks`.
- Core sem Node: só `@noble/*` e `sync/bytes.ts` (`no-node.test.ts`).
- `sync-vectors.json` **não** é regenerado; os vetores do selo vão num teste novo.
- Info HKDF `sagyou-remote-password-v1`; AAD `sagyou-remote-password|1|<b64 chave Ed25519 do celular>|<b64 chave Ed25519 do PC>`.
- `sealedPassword` = base64 de `efêmera X25519 (32) || nonce (24) || cifra+tag`; senha ≤ 1024 bytes UTF-8.
- Motivo novo `outdated` em `ResultReason`; **não conta** para a suspensão.
- Textos exatos (celular, `REMOTE_TEXT`):
  - `noPcKey`: `O PC ainda não publicou a chave dele. Atualize o Sagyou no PC e tente de novo.`
  - `pcKeyChanged`: `A chave do PC mudou. Autorize este celular em casa, comparando o código.`
  - `outdated`: `Atualize o Sagyou no celular.`
- Worker: `PUT /roles/pc/key` só para o `pc` atual (403 para os outros); `GET /roles/pc` → `{ pc, publicKey }`; tabela ausente → `501 {error:'control not deployed'}`.
- Nunca logar a senha, o selo nem a chave privada. Log novo: `remote`/`pc_key_published`, `remote`/`pc_key_publish_failed`.
- Versões: desktop `1.9.0`, celular `0.5.0` (`versionCode` 500), Worker reimplantado junto.

## Foco de Review

1. **Celular que já conhecia o PC e um Worker com outra chave:** nada é enviado e aparece
   `pcKeyChanged`. Testado na Task 5.
2. **Selo amarrado ao pedido:** um selo feito para a chave de outro celular, ou para outra
   chave de PC, não abre: recusa `shape`, **não conta**, igual ao corpo malformado de hoje
   (`ignored('shape')`, decisão do construtor). Testado nas Tasks 1 e 4.
3. **Corpo antigo com `password`:** a assinatura é conferida primeiro (`checkEnvelope` +
   `markSeen`, como hoje). Depois: recusa `outdated`, sem `verifyPassword`, sem contar, e o
   papel de controle é removido como em toda recusa. Testado na Task 4.
4. **Troca do PC no Worker** (`setPc` de outro aparelho): a chave antiga some, e o novo PC
   publica a dele no próximo heartbeat (30 s). Um PC antigo não consegue sobrescrever a
   chave. Testado nas Tasks 2 e 3.
5. **Dados existentes:** o D1 de quem já usa ganha a tabela pelo `schema.sql`
   (`CREATE TABLE IF NOT EXISTS`, idempotente). `remote-control.json` não muda: a chave
   X25519 é derivada de `pcKeys` (semente Ed25519 de 32 bytes, `newSigningKeys`). Antes de
   aplicar o schema: `PUT /roles/pc/key` → 501 e o PC só loga; `GET /roles/pc` → `publicKey:
   null`; `POST /roles/pc` continua funcionando. Testado nas Tasks 2 e 3.
7. **Celular que falha no meio do pedido** (autenticador errado, rede): `renew()` apaga
   `pcpub`, então a chave escolhida é regravada logo depois do `renew()`, antes do
   `remoteRole`. A nova tentativa continua conferindo contra ela. Testado na Task 5.
6. **`authorized` com outra chave num pedido de longe:** ignorado. Testado na Task 5.

### Task 1: selo da senha e corpo novo (core)

**Arquivos:**
- Modificar `packages/core/src/control/crypto.ts`, `packages/core/src/control/bodies.ts`
- Teste `packages/core/src/control/__tests__/crypto.test.ts`, `packages/core/src/control/__tests__/bodies.test.ts`

**Interfaces:** Produz:
- `sealPasswordToPc(pcPublicKey: Uint8Array, phonePublicKey: Uint8Array, password: string): string`
- `openPasswordFromPc(pcPrivateKey: Uint8Array, phonePublicKey: Uint8Array, sealed: string): string` (lança `ControlDecryptError`)
- `AuthorizeRemoteBody` = `{ name, publicKey, sealedPassword }`; `parseAuthorizeRemote(body)` → `{ ...base, key, sealedPassword: string } | { ...base, key, outdated: true } | null` (o ramo `outdated` traz `key`, para a assinatura ser conferida antes da recusa)
- `ResultReason` ganha `'outdated'`

- [ ] Passo 1: testes:
  - `selar e abrir devolve a senha` (inclusive `"senha çã 🔒"`).
  - `selo não abre com outra chave de PC`, `…com outra chave de celular`, `…com um byte trocado`, `…base64 inválido`, `…curto demais` → `ControlDecryptError`.
  - `dois selos da mesma senha são diferentes` (efêmera nova).
  - Vetor fixo: com chave PC `00 01 … 1f`, efêmera e nonce injetados (parâmetro interno `deps.random` só para teste), o resultado é a string pinada no teste.
  - `parseAuthorizeRemote`: com `sealedPassword` → objeto com `key`; com `password` e sem `sealedPassword` → `{ ..., key, outdated: true }`; `sealedPassword` > 2048 chars, ou nenhum dos dois → `null`; base inválida (`name`/`publicKey`) → `null`.
- [ ] Passo 2: rode (CI). Esperado: FALHA (funções inexistentes).
- [ ] Passo 3: `edwardsToMontgomeryPub`/`edwardsToMontgomeryPriv` e `x25519` de `@noble/curves/ed25519` (a chave privada do PC é a semente de 32 bytes). Chave = `hkdfSha256(shared || efêmeraPub || pcX25519Pub, 'sagyou-remote-password-v1', 32)` de `sync/bytes` (sem salt: as duas chaves públicas entram no IKM, depois do segredo). Segredo ECDH todo zero (ponto de ordem baixa) → `ControlDecryptError` ao abrir e erro ao selar. Cifra com `xchacha20poly1305(key, nonce, aad)`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(core): selar a senha do pedido de longe para a chave do PC`

### Task 2: chave do PC no Worker

**Arquivos:**
- Modificar `sync-server/schema.sql`, `sync-server/src/control-db.ts` (interface + D1 + memória), `sync-server/src/control-routes.ts`
- Teste `sync-server/src/__tests__/control-routes.test.ts`, `sync-server/src/__tests__/control-db.test.ts`, `sync-server/src/__tests__/control-d1.test.ts`

**Interfaces:** Produz no `ControlDb`: `getPcKey(): Promise<string | null>`, `setPcKey(id: string, key: string, now: number): Promise<void>`. `setPc` apaga a linha de `pc_key`.

- [ ] Passo 1: testes:
  - `GET /roles/pc` responde `{ pc, publicKey: null }` sem chave e `{ pc, publicKey }` depois do PUT.
  - `PUT /roles/pc/key` pelo `pc` → 200; por um controller ou outro aparelho → 403; chave que não tem 32 bytes em base64 → 400.
  - `setPc` de outro aparelho → `publicKey: null`, e o PUT do PC antigo → 403.
  - D1 sem a tabela `pc_key` → 501 `control not deployed` no PUT; no GET, `publicKey: null` (o GET de hoje continua respondendo); `POST /roles/pc` continua dando 200.
  - `control-d1.test.ts`: `schema.sql` aplicado duas vezes não falha.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: `schema.sql`: `CREATE TABLE IF NOT EXISTS pc_key (id INTEGER PRIMARY KEY CHECK (id = 1), device_id TEXT NOT NULL, public_key TEXT NOT NULL, updated_at INTEGER NOT NULL);`. `setPcKey` faz UPSERT `id = 1`. `setPc` roda `DELETE FROM pc_key` **depois** do batch de hoje, num statement à parte que ignora `isMissingTable` (um Worker sem a tabela continua trocando o PC). A rota é `{ pattern: /^\/roles\/pc\/key$/, methods: { PUT: setPcKeyRoute } }` com `requireRole(db, h, me.id, ['pc'])`. O GET captura `isMissingTable` só na leitura da chave.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync-server): chave pública do PC no Worker`

### Task 3: cliente e publicação pelo PC

**Arquivos:**
- Modificar `packages/core/src/control/client.ts`, `apps/desktop/src/main/modules/remote/remote-service.ts`
- Teste `packages/core/src/control/__tests__/client.test.ts`, `apps/desktop/src/main/__tests__/remote-service.test.ts`

**Interfaces:** Consome a Task 2. Produz no `ControlClient`: `pcKey(): Promise<{ pc: string | null; publicKey: Uint8Array | null }>` (o `pcId()` continua) e `publishPcKey(key: Uint8Array): Promise<void>`.

- [ ] Passo 1: testes:
  - client: `pcKey` decodifica a chave e devolve `null` para chave ausente ou inválida; `publishPcKey` faz `PUT /roles/pc/key` com o base64.
  - remote-service: em cada `heartbeat` (30 s), se `pcKey().pc` é este aparelho e `publicKey` é diferente da própria, chama `publishPcKey` (loga `pc_key_published`); igual → não chama; `pc` é outro aparelho → não chama; erro (incl. `not-deployed`) → loga `pc_key_publish_failed` e tenta no próximo heartbeat. Simula `setPc` de outro aparelho e a volta deste: a chave é republicada sem reiniciar.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: a checagem roda dentro de `heartbeat`, depois do `putStatus`, num try próprio (uma falha nunca impede o heartbeat). Sem flag: um `GET /roles/pc` a cada 30 s, decisão do construtor, cobre o PC que volta a ser o `pc`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): o PC publica a chave pública no Worker`

### Task 4: o PC abre o selo e recusa a senha sem selo

**Arquivos:**
- Modificar `apps/desktop/src/main/modules/remote/remote-service.ts` (`authorizeRemote`, ~l.305)
- Teste `apps/desktop/src/main/__tests__/remote-service.test.ts`

**Interfaces:** Consome `openPasswordFromPc` e `parseAuthorizeRemote` (Task 1) e `deps.pcPrivateKey()`.

- [ ] Passo 1: testes (o helper dos testes de `authorize-remote` passa a selar com a chave do PC do teste):
  - `senha selada certa autoriza` (o fluxo de hoje continua verde).
  - `senha selada errada` → `wrong-password`, conta.
  - `selo para outra chave de PC` → `shape`, não conta, `verifyPassword` não é chamado.
  - `corpo antigo com password` → resposta `outdated`, `verifyPassword` não é chamado, falhas seguidas não sobem (5 seguidos não suspendem), `removeController` é chamado.
  - `corpo antigo com assinatura inválida` → segue o caminho de hoje (`signature`, não conta), sem responder `outdated`.
  - `sem chave privada do PC` → `shape`, não conta.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: ordem: `parseAuthorizeRemote` → `checkEnvelope` (com `body.key`, também no ramo `outdated`) → `markSeen` → suspensão → `outdated` → `ignored('outdated'); refuse('outdated')`. Senão, `openPasswordFromPc(priv, body.key, body.sealedPassword)` num try; `ControlDecryptError` ou sem `priv` → `ignored('shape'); refuse('shape')`. A senha aberta fica só numa `const` local.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(remote): o PC só aceita a senha selada`

### Task 5: o celular busca a chave, confere e sela

**Arquivos:**
- Modificar `apps/mobile/src/remote/store.ts` (`requestRemote` ~l.422, `handle`/`authorized` ~l.283, `resultText` ~l.150), `apps/mobile/src/remote/texts.ts`
- Teste `apps/mobile/src/remote/__tests__/store.test.ts`, `apps/mobile/src/remote/__tests__/fakes.ts`

**Interfaces:** Consome `client.pcKey()` (Task 3) e `sealPasswordToPc` (Task 1).

- [ ] Passo 1: testes:
  - `sem chave no Worker`: `requestRemote` não chama `remoteRole`, o estado não muda e `error` = `noPcKey`.
  - `celular conhecia outra chave`: `pcpub` ≠ Worker → nada enviado, `error` = `pcKeyChanged`.
  - `celular novo`: envia `sealedPassword` (o fake abre com a chave do PC do teste e confere a senha), sem campo `password`, e grava `pcpub` com a chave do Worker.
  - `celular que conhecia a mesma chave` → envia.
  - Em `waiting-pc`, `authorized` assinado por **outra** chave → ignorado (estado continua `waiting-pc`).
  - Resultado `outdated` → `error` = `outdated`.
  - `autenticador errado e nova tentativa`: celular que conhecia a chave A, Worker com A, `remoteRole` falha → `pcpub` continua A; o Worker passa a ter B → a nova tentativa mostra `pcKeyChanged`.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: dentro do `run` de `requestRemote`, antes de `keys.renew()`: `const known = await d.keys.pcPublicKey()` e `const { publicKey } = await d.client.pcKey()`. Sem chave → `set({ error: REMOTE_TEXT.noPcKey }); return` (sem lançar, porque o `fail` transformaria em `generic`). `known && !sameKey(known, publicKey)` → `set({ error: REMOTE_TEXT.pcKeyChanged }); return`. Logo depois do `renew()`: `await d.keys.setPcPublicKey(publicKey)`, antes de selar e do `remoteRole`. `resultText` ganha `case 'outdated': return REMOTE_TEXT.outdated`. Em `authorized`, a condição `state === 'pending'` passa a valer também para `'waiting-pc'`: exige `pcKey && sameKey(pcKey, parsed.key)`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): pedido de longe sela a senha para a chave do PC`

### Task 6: docs, guia, versões e PR

**Arquivos:**
- Modificar `docs/seguranca/2026-11-04-ameacas-acesso-remoto.md` (seção 7: dívida → "resolvido em 2026-11-09"), `docs/specs/2026-11-03-controle-remoto-app.md` (nota sobre o corpo do `authorize-remote`), `README.md` (~l.161-163: senha selada; aplicar `schema.sql` e reimplantar o Worker na 1.9/0.5), `CLAUDE.md` e `GUIDE.md` (remote control: a senha vai selada; `/roles/pc/key`), `packages/core/src/sync/guide.ts` (l.~200: uma frase dizendo que a senha vai selada para o PC), `apps/desktop/package.json` → `1.9.0`, `apps/mobile/app.json` → `0.5.0` / `versionCode` 500
- Teste: os testes do guia e `app-config.test.ts` existentes

- [ ] Passo 1: atualize os textos. O teste do guia que pina os comandos `wrangler` continua igual aos do README.
- [ ] Passo 2: push, `gh pr checks`: suíte completa, typecheck e lint verdes.
- [ ] Passo 3: `sagyou-review` (com `sagyou-security-reviewer`: criptografia e autorização remota), depois `sagyou-pr`.
- [ ] Passo 4: no PR, a lista para o Luis: aplicar `schema.sql` no D1, publicar o Worker, atualizar PC e celular juntos e testar "Estou longe do PC" com um celular novo.
- [ ] Passo 5: commit `docs(selar-senha-remota): docs, guia e versões`
