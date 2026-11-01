# Plano de implementação: Sync, etapa 2 — dois PCs pela Cloudflare

Status: approved by Luis on 2026-10-30 (Task 7b aprovada em 2026-10-30)
Spec: docs/specs/2026-10-30-sync-cloudflare.md
Branch: feature/sync-cloudflare (base: feature/sync-registro-mudancas, PR #29)

**Objetivo:** dois PCs pareados trocam as versões da etapa 1, cifradas de ponta a ponta, por um Worker com D1, e aplicam o que recebem sem perder edição local.

**Arquitetura:** os módulos puros ficam em `src/main/modules/sync/` (cifra, lote, decisão de conflito, aplicar no estado). O `sync-engine.ts` orquestra rede e agenda com efeitos injetados. `store.ts` só faz o SQL e a guarda do salvamento atrasado. O Worker fica em `sync-server/`, com rotas puras sobre uma interface de banco, testadas com um banco falso em memória. O renderer ganha a seção Sincronização e recebe `sync:remote-changes` sem salvar.

## Restrições Globais

- **Testes não rodam localmente** (regra de Luis): cada task escreve o teste primeiro, commita, e o CI do PR é a prova. Nenhum passo diz "passa" sem o CI.
- **Cifra e lote:**
  - XChaCha20-Poly1305 (`@noble/ciphers`), nonce aleatório de 24 bytes por lote, HKDF-SHA256 (`@noble/hashes`).
  - Subchaves com `info`: `sagyou-sync-enc-v1` e `sagyou-sync-id-v1`.
  - Id opaco: `HMAC-SHA256(id, deviceId)`, primeiros 16 bytes em hex.
  - Lote: `{v: 1, records: [{kind, id, hlc, deleted, payload?}]}`, gzip e depois cifra. AAD = `sagyou-sync|1|<idOpaco>|<batchId>`.
  - Limites: 256 KB antes da cifra (`MAX_BATCH_BYTES = 262144`) e 500 registros (`MAX_BATCH_RECORDS = 500`).
- **Ritmo:**
  - envio 5 s depois do salvamento (`PUSH_DEBOUNCE_MS = 5000`);
  - push e pull ao abrir e a cada 60 s (`POLL_MS = 60000`);
  - backoff 2^n·5 s, com teto de 15 min (`MAX_BACKOFF_MS = 900000`).
- **Convite:** 10 min (`INVITE_TTL_MS = 600000`), uso único, guardado como hash.
- **Retenção e limpeza:**
  - conflitos ficam 30 dias (`CONFLICT_TTL_MS = 30·86400000`);
  - tombstone local sai depois de 90 dias (`TOMBSTONE_TTL_MS = 90·86400000`) e depois que todo aparelho não revogado passou do `seq` dele;
  - retrato a cada 5000 mudanças (`SNAPSHOT_EVERY_CHANGES = 5000`) ou 30 dias.
- **Código de recuperação:** a chave em base32 RFC 4648 sem padding (52 caracteres), em 13 grupos de 4 separados por `-`, numa linha, com a URL do servidor na linha seguinte.
- **Guarda local:**
  - Chave e token ficam em `userData/sync-config.json` (`sync-config-dev.json` em dev), cifrados por `safeStorage`, gravados com `.tmp` + rename e mode 0600, fora do SQLite e do backup.
  - Sem `safeStorage.isEncryptionAvailable()`, o sync não liga.
  - No Linux, `safeStorage.getSelectedStorageBackend() === 'basic_text'` também conta como indisponível.
- **Logs:** área `sync`, só contagens, `seq`, ms e resultado. Nunca chave, token, payload, nome de aparelho ou id opaco.
- **Banco:**
  - Tabelas novas com `CREATE TABLE IF NOT EXISTS`, fora de `persistAll`/`persistDiff` e do backup. Nenhuma tabela existente muda.
  - Dinheiro é sempre string decimal.
  - Aplicar no banco passa pelo `persistDiff` existente, nunca por SQL escrito à mão por kind.
- **IPC:** todo canal `sync:*` é registrado depois de `protectDataIpc(ipcMain)`.
- **Textos de tela** (exatos, da spec):
  - "Sincronizado há X min"
  - "N alterações aguardando envio"
  - "Sem conexão: as alterações ficam guardadas"
  - "Pausado: escolha o que vale"
  - "Este aparelho foi desconectado da sincronização"
  - "Restaurar também nos outros aparelhos?"
  - "Este aparelho já tem dados. Juntar com a nuvem ou substituir pelos da nuvem?"
  - "Disponível só em <aparelho>"
  - "conflito: escolha a versão"
  - "Guardei o código"

## Foco de Review

1. **Salvamento atrasado desfazendo mudança remota.** O renderer salva um estado que ainda não viu um lote aplicado. O main mantém a versão do banco para todo registro mudado remotamente depois da geração que o renderer informou. Testado na Task 6.
2. **Dados existentes ao parear com "Juntar".** Os dois PCs já têm dados, e nada pode sumir:
   - registros que só existem num lado sobrevivem;
   - os iguais (mesmo hash) não geram conflito;
   - os diferentes seguem a regra de conflito, e a perdedora vai para `sync_conflicts`;
   - "Substituir" faz o backup forçado antes.

   Testado nas Tasks 5, 6 e 7.
3. **Dívida editada nos dois lados.** Nunca é aplicada sozinha: fica o valor local, um `pending_choice` é criado, e os pagamentos ligados a ela não mudam. Testado na Task 5.
4. **Vazamento para o servidor ou para o log.** O corpo dos pedidos só leva o id opaco, o `ciphertext` e números. O log não tem payload. Um lote adulterado, ou de outra chave, é recusado sem aplicar nada. Testado nas Tasks 1, 4 e 7.
5. **Revogar e apagar.** O aparelho que recebe 401 com `wipe` apaga tudo da lista da Task 7, sem backup, e um 401 sem `wipe` não apaga nada. Uma falha de rede nunca é tratada como 401. Testado na Task 7.

## Decisões do construtor (respostas da checagem do plano)

Estas regras valem para todas as tasks e prevalecem sobre qualquer texto mais vago abaixo.

1. **Duas colunas novas em `sync_records`**, adicionadas por uma migração idempotente `migrateSyncRecordsColumns` em `store.ts` (`ALTER TABLE … ADD COLUMN` só se faltar em `PRAGMA table_info`). As duas são nulas nas linhas da etapa 1, que continuam válidas.
   - `base_hlc TEXT`: o HLC da versão anterior do registro no momento da captura. `captureSyncVersions` preenche `base_hlc` com o `hlc` que a linha tinha antes.
   - `server_seq INTEGER`: o `seq` do servidor em que essa versão subiu (resposta do `/push`) ou desceu (o `seq` do pull).
2. **Sem eco.**
   - O envio e o `pendingCount` usam `WHERE device_id = <este aparelho> AND seq > pushed_seq`.
   - Uma versão recebida é gravada em `sync_records` com `device_id` do remetente (o id opaco), o `hlc`, o `base_hlc` e o hash recebidos, e um `seq` local novo (o log local continua monotônico), mas nunca é reenviada.
   - `applyRemoteRecords` chama `persistDiff` **sem** `captureSyncVersions`. A versão é escrita à mão a partir do registro recebido.
   - No `saveData` seguinte, o hash do renderer bate com o recebido (mesmo `extractDataRecords`), e nada é capturado.
3. **Regra de conflito.**
   - Há conflito quando `incoming.baseHlc !== local.hlc`, ou seja, o remetente não viu a versão atual daqui.
   - Sem conflito: aplica se `incoming.hlc > local.hlc`, e senão `skip`.
   - Com conflito: o maior HLC vence, e a perdedora vai para `sync_conflicts` (`lww`). Os dois lados chegam ao mesmo vencedor.
   - `financial_debt` em conflito vira `pending_choice`: o local fica e o recebido é guardado.
   - A Task 5 troca `pushedSeq` por essa regra: `decideIncoming(incoming, local: { hlc; hash; deleted } | null, parent)`.
4. **Memórias recebidas** são aplicadas por `applyRemoteMemories(records)` em `store.ts`:
   - `writeMemoryRow` para `upsert`, `DELETE` para tombstone, depois `syncMemorySearchRows` e a versão gravada como no item 2;
   - nunca passa por `upsertMemory`/`captureMemoryRows`, para não recapturar;
   - `accessCount`/`lastAccessedAt` locais são mantidos quando a memória já existe.

   Entra na Task 6.
5. **Limpeza de tombstones** (Task 8): uma linha sai quando `deleted = 1`, `server_seq IS NOT NULL`, `server_seq <= minCursor` e o ms do HLC tem mais de 90 dias.
6. **`replace` e `take-cloud`:**
   1. backup forçado;
   2. zera o `pull_cursor`;
   3. puxa desde `since = 0` (a partir da Task 8, o retrato e depois o delta);
   4. monta o estado = os campos do aparelho locais + só os registros da nuvem;
   5. `persistAll` com esse estado, e `sync_records` dos dados reescrita a partir do recebido. Os registros só locais somem, e o backup forçado os guarda.

   **"Juntar"** aplica o recebido pela regra normal e depois envia tudo o que é local.
   A spec diz "sobe o retrato inicial" ao ativar. Até a Task 8, a ativação envia tudo como mudanças normais; a Task 8 troca isso pelo retrato.
7. **Retrato** (Task 8):
   - Partes de até 1,5 MB cifradas, cada uma com AAD `batchId = snapshot:<snapshotId>:<i>`.
   - `POST /snapshot/parts {snapshotId, index, ciphertext}`.
   - `POST /snapshot/commit {snapshotId, seqUntil, parts}`: só um retrato confirmado existe por vez, e o anterior é apagado no commit.
   - `GET /snapshot` → `{snapshotId, seqUntil, parts, device}`.
   - `GET /snapshot/parts/:i` → `{ciphertext}`.
   - `snapshotId` é um uuid gerado pelo aparelho.
8. **Id opaco em todo lugar.**
   - O cliente calcula `opaqueDeviceId` antes de `/setup` e de `/pair`, e o campo `deviceId` desses corpos é sempre o opaco. O servidor nunca recebe o id da etapa 1.
   - No `/push`, o `device` gravado vem do token, nunca do corpo.
   - O receptor usa o `device` devolvido pelo pull como `opaqueId` do AAD. Um servidor que troque o campo só faz a decifração falhar.
   - `loser_cipher` e `record_cipher` usam o id opaco **deste** aparelho no AAD.
9. **Tipos e canais.**
   - `WireRecord = { kind; id; hlc; baseHlc: string | null; deleted; payload? }`. O receptor recalcula o hash com `hashPayload`.
   - `SyncStatus = { state: 'off' | 'no-keychain' | 'ok' | 'offline' | 'paused' | 'disconnected'; lastSyncAt: number | null; pendingCount; paused: null | 'restore' | 'join'; deviceName; conflictCount }`. "Sincronizado há X min" vem de `lastSyncAt`.
   - `SaveData` é o tipo existente de `store.ts`.
   - Campos do aparelho preservados por `applyRecordsToState` e `replace`: `activeTimers`, `activeTimer`, `uiPreferences`, `activeFinancialProfileId`, `activeProjectId` e, em cada projeto, `codePaths`, `activeCodePathIds` e `activeCodePathId`.
   - Os canais `sync:after-restore` e `files:availability` entram na lista da Task 7, e o handler é registrado lá.
   - `PARENT_OF` usa o campo de pai como `extractDataRecords` o grava:
     - `habit_completion` → `habit`
     - `goal_entry` → `goal`
     - `project_link`/`project_column`/`sprint`/`note` → `project`
     - `task` → `project` (e `project_column`)
     - filhos financeiros → `financial_table`
     - `file` → `project` quando tem projeto, senão nenhum
10. **`sync_pending`** é reprocessada no fim de cada pull. Um filho cujo pai chegou é aplicado. Se o pai chegar como tombstone, o filho vira `orphan`. Pendentes com mais de 30 dias são descartados com o log `sync`/`pending_dropped` (só a contagem).
    - Um conflito `orphan` aparece na lista como "Removido: o item de origem foi apagado em outro aparelho", só com "Dispensar".
11. **Falhas e casos que faltavam nos testes.**
    - Um lote que não decifra é logado (`sync`/`decrypt_failed`), pulado, e o cursor avança. Teste na Task 7.
    - Uma transação com `debtId` que chega junto com uma dívida em `pending_choice` é aplicada normalmente, e a dívida local não muda. Teste na Task 6.
    - Dois aparelhos com registros de mesmo hash ao "Juntar" não geram conflito. Teste na Task 7.
12. **Rede de volta:** o renderer chama `sync:now` no evento `online` da janela. Teste na Task 9.
13. **`loadSyncConfig`** devolve `{ status: 'none' | 'ok' | 'corrupt' | 'no-keychain'; config? }`.
14. **Worker:** os testes têm `// @vitest-environment node` e usam `globalThis.crypto` (Node 20+).

### Task 1: cifra, chaves e código de recuperação (Sync 2.2)
**Arquivos:**
- Criar `src/main/modules/sync/sync-crypto.ts`.
- Teste `src/main/__tests__/sync-crypto.test.ts`.
- `package.json`: `@noble/ciphers` e `@noble/hashes` em `dependencies`.

**Interfaces — Produz:**
- `newSyncKey(): Uint8Array`, com 32 bytes.
- `deriveKeys(syncKey): { enc: Uint8Array; id: Uint8Array }`.
- `opaqueDeviceId(idKey, deviceId): string`.
- `sealBatch(encKey, opaqueId, batchId, plain: Uint8Array): string`, que devolve base64 de `nonce||ciphertext`.
- `openBatch(encKey, opaqueId, batchId, sealed): Uint8Array`, que lança `SyncDecryptError`.
- `toRecoveryCode(key, url): string` e `fromRecoveryCode(text): { key; url }`.

- [ ] Passo 1: testes:
  - abrir o que foi selado devolve os mesmos bytes;
  - um byte trocado, outro `opaqueId`, outro `batchId` ou outra chave fazem lançar `SyncDecryptError`;
  - dois selos do mesmo texto saem diferentes (nonce);
  - `opaqueDeviceId` tem 32 hex, é estável e muda com a chave;
  - o código de recuperação faz ida e volta, aceita minúsculas e espaços, e recusa checksum ou tamanho errados.

  Um 14º grupo de 4 caracteres leva os 2 primeiros bytes do SHA-256 da chave, em base32, como checksum (decisão do construtor).
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): cifra de ponta a ponta e código de recuperação`.

### Task 2: lotes a enviar (Sync 2.1)
**Arquivos:** Criar `src/main/modules/sync/sync-batch.ts`. Teste `src/main/__tests__/sync-batch.test.ts`.

**Interfaces — Consome:** `SyncRecord` e `extractDataRecords`/`extractMemoryRecords` (etapa 1).

**Interfaces — Produz:**
- `type OutgoingRow = { kind; id; hlc; deleted; seq }`.
- `buildOutgoing(rows: OutgoingRow[], current: Map<string, SyncRecord>): WireRecord[]`. O payload vem do estado **atual**. Uma linha não apagada sem registro atual vira `deleted: true`.
- `packBatches(records: WireRecord[]): { records: WireRecord[]; bytes: number }[]`, respeitando `MAX_BATCH_BYTES` e `MAX_BATCH_RECORDS`. Um registro sozinho maior que o limite vai sozinho num lote.
- `encodeBatch`/`decodeBatch` (gzip com `zlib`, JSON `{v: 1, records}`). `decodeBatch` recusa `v !== 1` ou forma inválida.

- [ ] Passo 1: testes:
  - 1200 registros pequenos geram 3 lotes (500/500/200);
  - registros grandes respeitam os 256 KB;
  - um tombstone não tem payload;
  - `decodeBatch(encodeBatch(x))` devolve `x`;
  - `v: 2` lança erro;
  - um registro sem estado atual sai como `deleted`.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): lotes de envio a partir de sync_records`.

### Task 3: configuração local cifrada (Sync 2.2)
**Arquivos:** Criar `src/main/modules/sync/sync-config.ts`. Teste `src/main/__tests__/sync-config.test.ts`, com um diretório temporário e `safeStorage` falso.

**Interfaces — Produz:**
- `type SyncConfig = { url; syncKey: Uint8Array; token; deviceName; paused: null | 'restore' | 'join' }`.
- `syncAvailability(safe): 'ok' | 'no-keychain'`.
- `loadSyncConfig(dir, file, safe): SyncConfig | null`.
- `saveSyncConfig(dir, file, safe, cfg)`.
- `clearSyncConfig(dir, file)`.

- [ ] Passo 1: testes:
  - `basic_text`, ou `isEncryptionAvailable` falso, dá `'no-keychain'`, e salvar nesse caso lança erro;
  - o JSON gravado não contém a chave nem o token em claro (busca pelo hex e pelo base64);
  - a escrita é atômica e usa mode 0600;
  - um arquivo corrompido lê como `null` e loga `sync`/`config_corrupt`.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): configuração do sync guardada no cofre do sistema`.

### Task 4: Worker Cloudflare + D1 (Sync 2.3)
**Arquivos:**
- Criar em `sync-server/`: `src/index.ts` (fetch → router), `src/routes.ts` (handlers puros), `src/db.ts` (interface `SyncDb` e a implementação D1), `schema.sql`, `wrangler.toml`, `package.json` e `tsconfig.json`.
- Teste `sync-server/src/__tests__/routes.test.ts`, com um `SyncDb` em memória.
- Modificar `vitest.config.ts`: `include` ganha `'sync-server/src/**/*.test.ts'`.

**Schema:**
- `devices(id TEXT PK, token_hash TEXT, name_cipher TEXT, last_seen INTEGER, revoked_at INTEGER, wipe INTEGER DEFAULT 0, cursor INTEGER DEFAULT 0)`
- `changes(seq INTEGER PK AUTOINCREMENT, device TEXT, ciphertext TEXT, size INTEGER, created_at INTEGER)`
- `invites(hash TEXT PK, expires_at INTEGER, used_at INTEGER)`
- `snapshots(id INTEGER PK, seq_until INTEGER, ciphertext TEXT, created_at INTEGER)`

**Rotas:**

| Rota | Comportamento |
|---|---|
| `POST /setup` | Header `X-Setup-Token`, comparado em tempo constante com `env.SETUP_TOKEN`. Corpo `{deviceId, nameCipher}`. Devolve `{token}`. |
| `POST /pair` | `{invite, deviceId, nameCipher}`. Devolve `{token}`. Convite vencido ou usado dá 410. |
| `POST /invites` | Recebe `{inviteHash}`. O aparelho gera o convite, e o servidor só guarda o hash. |
| `POST /push` | `{batches: [{batchId, ciphertext}]}`. Devolve `{seqs}`. |
| `GET /pull?since=N&limit=50` | Devolve `{changes: [{seq, device, batchId, ciphertext}], more}` e atualiza `cursor`. |
| `GET /devices` | Lista os aparelhos. |
| `POST /devices/:id/revoke` | `{wipe: boolean}`. |
| `GET /snapshot` e `POST /snapshot` | Usadas na Task 8. |

Token: 32 bytes aleatórios em base64url, guardado como SHA-256 hex. Corpo acima de 2 MB dá 413.

- [ ] Passo 1: testes:
  - sem token, 401;
  - token revogado: 401 com `{revoked: true, wipe}`;
  - `SETUP_TOKEN` errado: 401, e o certo registra;
  - um convite funciona uma vez, e a segunda vez e o vencido dão 410;
  - push seguido de pull devolve na ordem de `seq`, e `since` filtra;
  - `limit` é respeitado e põe `more: true`;
  - o pull não devolve os lotes do próprio aparelho;
  - nenhuma resposta ou registro de banco tem o token em claro;
  - o corpo de 2 MB + 1 dá 413.
- [ ] Passo 2: implemente. O README ganha a seção "Servidor de sincronização", com `wrangler d1 create`, `wrangler d1 execute --file schema.sql`, `wrangler secret put SETUP_TOKEN` e `wrangler deploy`.
- [ ] Passo 3: commit `feat(sync-server): Worker e D1 do sync`.

### Task 5: decisão de conflito (Sync 2.5)
**Arquivos:** Criar `src/main/modules/sync/sync-merge.ts`. Teste `src/main/__tests__/sync-merge.test.ts`.

**Interfaces — Produz:**
- `decideIncoming(incoming: WireRecord, local: { hlc; hash; deleted; pushedSeq: number | null } | null, parentPresent: boolean, parentDeleted: boolean): Decision`.
- `Decision` é uma destas:
  - `{ type: 'apply' }`
  - `{ type: 'skip' }`: mesmo hash, ou HLC já visto.
  - `{ type: 'apply-and-keep-loser'; loser: 'local' }`
  - `{ type: 'keep-local-and-keep-loser'; loser: 'incoming' }`
  - `{ type: 'pending-choice' }`
  - `{ type: 'wait-parent' }`
  - `{ type: 'orphan-conflict' }`
- `PARENT_OF: Partial<Record<SyncKind, (payload) => { kind; id } | null>>`, com o pai de coluna, link, tarefa, sprint, nota, entrada de meta, marcação de hábito, transação, item, dívida, meta financeira, fonte e entrada de rendimento.

**Regra:**
- Há conflito quando o local tem uma edição ainda não enviada, ou enviada depois do HLC base. Nesse caso, quem tem o maior HLC vence.
- `financial_debt` com edição local não enviada dá `pending-choice`.

- [ ] Passo 1: testes:
  - sem versão local, aplica;
  - mesmo hash, `skip`;
  - remoto mais novo e local já enviado, aplica sem conflito;
  - local não enviado mais novo: mantém o local e guarda o remoto;
  - local não enviado mais velho: aplica e guarda o local;
  - dívida com edição local não enviada: `pending-choice` nos dois sentidos de HLC;
  - tarefa sem a coluna ou o projeto: `wait-parent`;
  - tarefa de projeto com tombstone: `orphan-conflict`;
  - tombstone remoto contra edição local não enviada mais nova: mantém o local.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): regra de conflito por registro`.

### Task 6: aplicar no banco e guarda do salvamento atrasado (Sync 2.4)
**Arquivos:**
- Criar `src/main/modules/sync/sync-apply.ts`. Teste `src/main/__tests__/sync-apply.test.ts`.
- Modificar `src/main/store.ts`, `src/preload/index.ts` e `src/renderer/src/store/kanban.ts`. Teste `src/renderer/src/__tests__/store/sync-remote.test.ts`.

**Interfaces — Produz (puro):**
- `applyRecordsToState(state: SaveData, records: WireRecord[]): SaveData`, o inverso de `extractDataRecords`. Insere, substitui ou remove por kind e id, mantendo os campos do aparelho (code paths, timers, uiPreferences, perfil ativo).
- `guardStaleSave(next: SaveData, current: SaveData, remoteKeys: Set<string>): SaveData`: para cada `kind:id` em `remoteKeys`, o registro de `next` é trocado pelo de `current`.

**Interfaces — Produz (`store.ts`):**
- Tabelas:
  - `sync_state(key TEXT PK, value TEXT)`, com as chaves `pull_cursor`, `pushed_seq`, `generation` e `paused`;
  - `sync_conflicts(id TEXT PK, kind, record_id, type 'lww'|'pending_choice'|'orphan', loser_cipher TEXT, winner_hlc, loser_hlc, loser_device, created_at, resolved_at)`;
  - `sync_pending(kind, id, record_cipher, received_at, PRIMARY KEY(kind, id))`.
- `applyRemoteRecords(records, decisions)`:
  1. Uma transação faz `loadData` → `applyRecordsToState` → `persistDiff(lastSnapshot, next)`.
  2. Grava em `sync_records` a versão recebida (HLC e aparelho do lote) e incrementa `generation`.
  3. Guarda `remoteKeysByGeneration`.
  4. Atualiza `lastSnapshot` e o FTS.
- `saveData(data)` lê `data.syncGeneration` (número opcional; ausente = 0) e aplica `guardStaleSave` com as chaves remotas de gerações maiores que essa antes de `persistDiff`.
- `loser_cipher` e `record_cipher` são cifrados com `enc` (`sealBatch` com `batchId = 'conflict:<id>'`), porque guardam payload em repouso.

**Renderer:**
- O preload expõe `sync.onRemoteChanges(cb)`.
- `kanban.ts` aplica `{generation, state}` com `set` **sem** `_persist`, guarda `syncGeneration` e o inclui no payload de `_persist`.

- [ ] Passo 1: testes:
  - `extractDataRecords(applyRecordsToState(a, extract(b)))` tem os mesmos hashes de `b`, kind a kind;
  - os campos do aparelho de `a` continuam intactos;
  - um tombstone de transação a remove só da tabela dela;
  - `guardStaleSave` mantém a versão de `current` para a chave remota e aceita as outras edições do renderer;
  - no renderer, `onRemoteChanges` atualiza tarefas sem chamar `storage.save`, e o próximo `_persist` leva `syncGeneration`.
- [ ] Passo 2: implemente. O SQL de `applyRemoteRecords` é verificado no app na Task 11.
- [ ] Passo 3: commit `feat(sync): aplicar mudanças recebidas sem desfazer edição local`.

### Task 7: motor, pareamento, revogar e apagar (Sync 2.6 e 2.1)
**Arquivos:**
- Criar `src/main/modules/sync/sync-engine.ts`. Teste `src/main/__tests__/sync-engine.test.ts`, com fetch, relógio, store e efeitos falsos.
- Criar `src/main/handlers/sync.ts`.
- Modificar `src/main/index.ts` (registrar depois de `protectDataIpc`; chamar `engine.notifySaved()` em `store:save`) e `src/preload/index.ts`.

**Interfaces — Produz:** `createSyncEngine(deps)` com `start()`, `stop()`, `notifySaved()`, `syncNow()`, `status(): SyncStatus`, `activate(url, setupToken, deviceName)`, `createInvite(): string`, `join(code, mode: 'merge' | 'replace')`, `devices()`, `revoke(id, wipe)`, `conflicts()`, `resolve(conflictId, choice: 'local' | 'remote')`, `recoveryCode()`, `disable()` e `resume(choice: 'push-local' | 'take-cloud')`.

**Canais IPC:** `sync:status`, `sync:activate`, `sync:invite`, `sync:join`, `sync:now`, `sync:devices`, `sync:revoke`, `sync:conflicts`, `sync:resolve`, `sync:recovery-code`, `sync:disable`, `sync:resume`, `sync:status-changed` (main→renderer) e `sync:remote-changes` (main→renderer).

**Comportamento:**
- O texto de pareamento é `sagyou-sync:1:<url base64url>:<chave base64url>:<convite>`.
- Ao entrar com `replace`, o motor chama primeiro o backup forçado existente (`backup:auto-save` forçado). Se ele falhar, o pareamento é abortado.
- Um 401 com `wipe` dispara a sequência:
  1. fecha o banco;
  2. apaga `kanban.db` (memórias incluídas), `files/`, `task-images/`, `backups/`, `agent-runs/`, `sync-config.json` e `sync-device.json`, e mantém `ai-config.json`, que não tem dados;
  3. relança o app.

  Não faz backup antes (decisão de Luis, opção A).
- Um 401 sem `wipe` limpa só `sync-config.json` e mostra "Este aparelho foi desconectado da sincronização".
- Erro de rede ou 5xx: backoff, e o estado vira "Sem conexão".
- O status traz `pendingCount`, que é `COUNT(*) FROM sync_records WHERE seq > pushed_seq`.

- [ ] Passo 1: testes:
  - push seguido de pull entre dois motores falsos sobre o mesmo servidor falso converge;
  - 5 s depois de `notifySaved` sai um push só, mesmo com 10 chamadas;
  - o backoff dobra até 15 min e volta a 60 s depois de um sucesso;
  - um `TypeError` de rede nunca apaga nada;
  - 401 sem `wipe` não apaga; 401 com `wipe` apaga exatamente a lista acima e nada fora de `userData`;
  - um backup forçado que falha impede o `replace`;
  - "Juntar" mantém os registros dos dois lados;
  - os corpos de pedido capturados não contêm nenhum título, valor ou id de registro da fixture.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): motor de sincronização e pareamento`.

### Task 7b: prova da chave e Google Authenticator para apagar (adendo da spec)
**Arquivos:**
- Modificar `sync-server/src/routes.ts`, `db.ts` e `schema.sql`:
  - tabela `auth(key_proof_hash TEXT, totp_cipher TEXT, totp_confirmed INTEGER, backup_hashes TEXT, fail_count INTEGER, locked_until INTEGER)` com uma linha só;
  - `POST /totp/enroll` e `POST /totp/confirm`.
- Modificar `sync-crypto.ts` (`keyProof(idKey)`), `sync-engine.ts`, `handlers/sync.ts` e `SyncSettings.tsx`.
- Testes em `routes.test.ts`, `sync-engine.test.ts` e `SyncSettings.test.tsx`.

**Comportamento:**
- `/setup` sem nenhum aparelho grava `key_proof_hash`. Com aparelhos ativos, exige `X-Key-Proof` válido e TOTP (se cadastrado).
- `POST /devices/:id/revoke` exige `X-Key-Proof`. Com `wipe: true`, exige também `totp` ou um código reserva (que é consumido).
- O TOTP é verificado no Worker com `crypto.subtle` (HMAC-SHA1, 6 dígitos, janela ±1). 5 falhas bloqueiam por 15 min.
- O cadastro exige `X-Key-Proof` e confirma com o primeiro código. Ele devolve uma vez os 8 códigos reserva, e o servidor guarda só os hashes deles.

- [ ] Passo 1: testes:
  - setup com aparelhos e sem prova dá 401;
  - revoke sem prova dá 401;
  - revoke com wipe e sem TOTP dá 401, e com o código certo funciona;
  - um código reserva funciona uma vez;
  - 5 erros dão 429 até passarem 15 min;
  - o segredo TOTP não aparece em claro no banco;
  - na UI, "Também apagar os dados dele" pede o código.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): prova da chave e autenticador para apagar aparelho`.

### Task 8: retrato e limpeza de tombstones (Sync 2.7)
**Arquivos:**
- Modificar `sync-engine.ts`, `sync-server/src/routes.ts` e `store.ts`, com `pruneSyncTombstones(minCursor, nowMs)`.
- Testes em `sync-engine.test.ts` e `routes.test.ts`.

**Comportamento:**
- O retrato é o lote completo do estado atual (vários lotes concatenados num `ciphertext` com `{v: 1, parts}`). Sobe quando `seq` passa de `SNAPSHOT_EVERY_CHANGES` desde o último, ou depois de 30 dias.
- O servidor apaga as `changes` com `seq <= seq_until` só quando `MIN(cursor)` dos aparelhos não revogados é maior ou igual a `seq_until`.
- Um aparelho novo, com `since = 0`, baixa o retrato e depois o pull a partir de `seq_until`.
- Localmente, `pruneSyncTombstones` apaga as linhas `deleted = 1` com mais de 90 dias e `seq <= minCursor`. O `minCursor` vem de `GET /devices`.

- [ ] Passo 1: testes:
  - o retrato não apaga `changes` enquanto um aparelho está atrasado;
  - um aparelho revogado não segura a limpeza;
  - um aparelho novo converge só com retrato + delta;
  - um tombstone com 89 dias fica, e um com 91 dias e abaixo do cursor sai.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): retrato completo e limpeza de tombstones`.

### Task 9: tela Sincronização e marcadores (Sync 2.8)
**Arquivos:**
- Criar `src/renderer/src/components/settings/SyncSettings.tsx`. Teste `src/renderer/src/__tests__/components/SyncSettings.test.tsx`.
- Modificar:
  - `SettingsView.tsx`, com a seção nova;
  - `components/financial/` (o componente da linha de dívida), com o marcador "conflito: escolha a versão";
  - `FilesView.tsx`, com "Disponível só em <aparelho>" e o botão de abrir desativado.
- O main expõe `files:availability` → `{[fileId]: deviceName | null}`. É `null` quando os bytes existem; senão, é o nome do aparelho de `sync_records.device_id`, resolvido pela lista de aparelhos (nomes cifrados, decifrados no main).

**Conteúdo da tela, segundo `UI_DESIGN.md`:**
- estados com os textos exatos das Restrições;
- "Sincronizar agora";
- a lista de aparelhos com "Revogar", que abre uma confirmação com a caixa "Também apagar os dados dele" e o aviso "Os dados deste aparelho serão apagados sem backup; eles continuam na nuvem e nos outros aparelhos";
- a lista de conflitos com as duas versões e "Usar esta";
- "Parear novo aparelho", que mostra o texto e o QR (`qrcode`, nova dependência, gerado no renderer);
- "Entrar com código";
- "Ver código de recuperação", que pede a senha do app se houver;
- "Desativar sincronização";
- `no-keychain`, que mostra por que não liga.

- [ ] Passo 1: testes:
  - cada estado mostra o texto exato;
  - "Revogar" sem a caixa marcada chama `revoke(id, false)`;
  - "Usar esta" chama `resolve` com a escolha;
  - um arquivo indisponível mostra o texto e o botão desativado;
  - a dívida com conflito mostra o marcador.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): tela Sincronização`.

### Task 10: restaurar backup com o sync ligado (Sync 2.9)
**Arquivos:** Modificar `src/renderer/src/store/slices/backup.ts` (ou o componente que chama `importBackup`), o `sync-engine.ts` e o handler. Teste `src/renderer/src/__tests__/store/backup-sync.test.ts` e casos em `sync-engine.test.ts`.

**Comportamento:**
- Com o sync ativo, depois de uma importação bem-sucedida, o app pergunta "Restaurar também nos outros aparelhos?".
- **Sim:** chama `sync:after-restore('propagate')`. O motor só segue: a captura da etapa 1 já gerou versões novas.
- **Não:** chama `sync:after-restore('pause')`, e `paused` passa a valer `'restore'`.
- `resume('push-local')` limpa a pausa e envia. `resume('take-cloud')`:
  1. faz um backup forçado;
  2. zera `pull_cursor`;
  3. baixa o retrato;
  4. aplica tudo, substituindo o estado local.
- O id do aparelho nunca vem do backup (já garantido na etapa 1; o teste confirma).

- [ ] Passo 1: testes:
  - sem sync, nenhuma pergunta;
  - "Não" deixa o status como "Pausado: escolha o que vale" e não faz push;
  - `take-cloud` com o backup forçado falhando não apaga nada.
- [ ] Passo 2: implemente.
- [ ] Passo 3: commit `feat(sync): restaurar backup com o sync ligado`.

### Task 11: segurança, dois PCs, documentação e PR (Sync 2.10)
**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md` e `README.md`.

- [ ] Passo 1: `/sagyou-review` com o `sagyou-security-reviewer` (cifra, tokens, Worker, apagar) e o `sagyou-ui-reviewer`.
- [ ] Passo 2: verificação real, feita por Luis:
  - publicar o Worker;
  - ativar no PC de casa e parear o Linux do trabalho;
  - editar a mesma tarefa offline nos dois e reconectar: aparece um conflito, e a perdedora fica visível;
  - editar uma dívida nos dois: fica `pending_choice`;
  - lançar uma transação: ela chega em até 1 min;
  - revogar com apagar num terceiro perfil de teste;
  - restaurar um backup com "Não": fica pausado.
- [ ] Passo 3: documentação:
  - `CLAUDE.md`: módulo `modules/sync/`, tabelas `sync_*`, `sync-config.json` na tabela de `userData`, canais `sync:*` e `sync-server/`;
  - `GUIDE.md`: as regras que quebram dados (tabelas `sync_*` fora de `persistAll` e do backup, chave só no `safeStorage`, `guardStaleSave` no `saveData`);
  - `README.md`: como publicar o Worker e parear.
- [ ] Passo 4: commit `docs(sync): sincronização pela Cloudflare`. Depois `/sagyou-pr`, com a base na branch da etapa 1 enquanto o #29 não entrar.
