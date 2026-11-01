# Plano de implementação: Sync, etapa 1 — registro de versões por registro

Status: approved by Luis on 2026-10-30
Spec: docs/specs/2026-10-30-sync-registro-mudancas.md
Branch: feature/sync-registro-mudancas

**Objetivo:** cada registro sincronizável ganha uma versão (HLC, aparelho, hash, excluído)
numa tabela nova `sync_records`, atualizada em todo salvamento, sem alterar o que o
usuário vê nem as tabelas existentes.

**Arquitetura:** a lógica fica em funções puras em `src/main/modules/sync/` (extrair
registros na forma de linha persistida, hash, comparar com as versões guardadas, montar
as linhas a gravar, HLC, id do aparelho). `store.ts` só faz o SQL: cria a tabela, chama a
captura num savepoint em `saveData` e nas escritas de memória, e reconcilia na abertura.

## Restrições Globais

- Nenhuma tabela, coluna ou formato existente muda. Só `CREATE TABLE IF NOT EXISTS sync_records` e dois índices.
- `sync_records`: `kind TEXT NOT NULL, id TEXT NOT NULL, hlc TEXT NOT NULL, device_id TEXT NOT NULL, hash TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY (kind, id)`; índices `idx_sync_records_seq ON sync_records(seq)` e `idx_sync_records_hlc ON sync_records(hlc)`.
- `persistAll` e `persistDiff` não tocam `sync_records`.
- Arquivo do aparelho: `userData/sync-device.json` em produção, `userData/sync-device-dev.json` quando `is.dev`. Conteúdo `{ "deviceId": "<32 hex>", "createdAt": "<ISO>" }`. Fora de todo backup.
- Uma falha da captura **nunca** desfaz o salvamento dos dados: roda num savepoint (`db.transaction(...)()` aninhado) e o erro vai para `log.error('sync', 'capture_failed', { msg })`.
- Log só com ids, contagens, nomes de kind e milissegundos — nunca título, corpo, valor ou payload (regra do `logger.ts`).
- **O payload de cada kind é uma lista fixa de campos**, na forma em que `prepareWrite().insert` grava no SQLite (decisão do construtor, resposta à checagem): `?? null` para opcionais, booleanos como `true/false`, dinheiro por `moneyText`, `details` por `transactionDetails`. Campo que o SQLite não guarda não entra. Assim, o objeto vindo do renderer e o lido por `loadData` dão o mesmo hash.
- **`updatedAt` fica fora do hash em todos os kinds** (decisão do construtor, resposta à checagem): o renderer muda o `updatedAt` do pai ao mexer num filho (`slices/financial.ts`, `goals.ts`, `habits.ts`, `projects.ts`) e ao trocar caminho de código. Ele continua no payload; só não decide se houve mudança.
- Fora do payload: `project.columns/links/codePaths/activeCodePathIds/activeCodePathId`; `goal.entries`; `habit.completions`; `financial_table.items/transactions/goals/yieldSources/yieldEntries/debts`; `memory.accessCount/lastAccessedAt/sourceConversationId`. Nunca geram versão: `activeTimers`, `activeTimer`, `uiPreferences`, `featurePreferences`, `activeFinancialProfileId`, `tombstones[]` (array legado), `entityEvents`.
- Nenhum texto de UI novo.

## Foco de Review

1. **Dados existentes na primeira abertura.** Banco real com `sync_records` vazia: a abertura cria exatamente uma linha por registro sincronizável e por memória, `deleted = 0`, e não altera nenhuma outra tabela. Testado nas Tasks 4–5 (puro) e verificado no app na Task 7.
2. **Versões falsas a cada sessão.** Se o hash do objeto do renderer diferir do hash da forma lida por `loadData`, o primeiro salvamento depois da abertura versiona tudo. A lista fixa de campos e o `updatedAt` fora do hash existem para isso. Testado na Task 3 e verificado no app na Task 7 (salvar só uma mudança de tema não muda `MAX(seq)`).
3. **Granularidade financeira.** Adicionar uma transação gera exatamente uma linha nova (`transaction:<id>`) e nenhuma outra muda; excluir a tabela gera tombstone para ela e para cada filho. Testado nas Tasks 3 e 4; verificado na Task 7.
4. **Campos do aparelho.** Mudar caminho de código, timer, tema ou perfil ativo não gera versão. Testado na Task 4; verificado na Task 7.
5. **Memórias parciais.** Salvar uma memória não transforma as outras em tombstone; tocar não gera versão; arquivar gera. Testado nas Tasks 4 e 6.

### Task 1: relógio híbrido (HLC)

**Arquivos:** Criar `src/main/modules/sync/hlc.ts` · Teste `src/main/__tests__/sync-hlc.test.ts`
**Interfaces:** Produz `nextHlc(nowMs: number, last: string | null, deviceId: string): string` e `parseHlc(hlc: string): { ms: number; counter: number; deviceId: string } | null`.

Formato: `<ms em decimal com 15 dígitos>-<contador em hex com 4 dígitos>-<deviceId>`. Strings desse formato ordenam corretamente por `<`.

- [ ] Passo 1: testes:
  - `nextHlc(1000, null, 'a')` === `'000000000001000-0000-a'`.
  - Com `last = nextHlc(1000, null, 'a')`, `nextHlc(1000, last, 'a')` === `'000000000001000-0001-a'`.
  - Relógio voltou: `nextHlc(500, '000000000001000-0003-a', 'a')` === `'000000000001000-0004-a'`.
  - Contador em `ffff`: `nextHlc(1000, '000000000001000-ffff-a', 'a')` === `'000000000001001-0000-a'`.
  - `last` de outro aparelho com ms maior: `nextHlc(1000, '000000000002000-0005-b', 'a')` === `'000000000002000-0006-a'`.
  - `parseHlc('lixo')` === `null`; `nextHlc(1000, 'lixo', 'a')` === `'000000000001000-0000-a'`.
  - 1000 chamadas encadeadas com `nowMs` aleatório produzem uma sequência estritamente crescente.
- [ ] Passo 2: `npx vitest run src/main/__tests__/sync-hlc.test.ts`. Esperado: FALHA (módulo não existe).
- [ ] Passo 3: implemente em `hlc.ts`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): relógio híbrido para versões`.

### Task 2: id do aparelho

**Arquivos:** Criar `src/main/modules/sync/device-id.ts` · Teste `src/main/__tests__/sync-device-id.test.ts`
**Interfaces:** Produz `loadOrCreateDeviceId(userDataDir: string, fileName: string, onNew?: (reason: 'missing' | 'corrupt') => void): string` e as constantes `SYNC_DEVICE_FILE = 'sync-device.json'`, `SYNC_DEVICE_FILE_DEV = 'sync-device-dev.json'`.

A spec pede `device_id_reset` para arquivo "ilegível ou ausente". Ausente na primeira abertura é o caso normal, então o `store.ts` loga `log.info('sync', 'device_id_created')` para `'missing'` e `log.warn('sync', 'device_id_reset')` para `'corrupt'` (decisão do construtor; o reset continua registrado em ambos os casos).

- [ ] Passo 1: testes (diretório temporário, padrão de `legacy-chat-state.test.ts`):
  - Arquivo ausente: cria o arquivo com `deviceId` casando `/^[0-9a-f]{32}$/` e `createdAt` ISO; chama `onNew('missing')` uma vez.
  - Segunda chamada devolve o mesmo id e não chama `onNew`.
  - JSON inválido, ou `deviceId` fora do formato: gera id novo, regrava o arquivo e chama `onNew('corrupt')` uma vez.
  - Depois de qualquer chamada não sobra `<arquivo>.tmp`.
  - `fileName` diferente gera id diferente.
- [ ] Passo 2: `npx vitest run src/main/__tests__/sync-device-id.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente com `randomBytes(16).toString('hex')` e `.tmp` + `renameSync`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): id do aparelho fora do banco e do backup`.

### Task 3: registros sincronizáveis na forma de linha persistida

**Arquivos:** Criar `src/main/modules/sync/sync-records.ts` · Criar `src/main/modules/financial/money-text.ts` (recebe `moneyText` e `transactionDetails` de `store.ts`, sem mudar comportamento) · Modificar `src/main/store.ts` (importa os dois do módulo novo) · Teste `src/main/__tests__/sync-records.test.ts`
**Interfaces:** Consome `moneyText(v: unknown): string`, `transactionDetails(value: unknown)`. Produz:
- `type SyncKind = 'project' | 'project_column' | 'project_link' | 'task' | 'sprint' | 'note' | 'goal' | 'goal_entry' | 'habit' | 'habit_completion' | 'financial_profile' | 'financial_table' | 'financial_debt' | 'transaction' | 'shopping_item' | 'financial_goal' | 'yield_source' | 'yield_entry' | 'file' | 'time_block' | 'routine' | 'memory'`
- `DATA_KINDS: readonly SyncKind[]` (todos menos `memory`) e `MEMORY_KINDS: readonly SyncKind[]` (`['memory']`)
- `interface SyncRecord { kind: SyncKind; id: string; payload: Record<string, unknown>; hash: string }`
- `extractDataRecords(data: SyncSourceData): SyncRecord[]` — `SyncSourceData` é interface estrutural com `projects`, `tasks`, `sprints`, `notes`, `goals`, `habits`, `lists`, `financialProfiles?`, `files`, `timeBlocks?`, `routines?` como registros genéricos (não importa `store.ts`).
- `extractMemoryRecords(memories: AiMemory[]): SyncRecord[]`
- `canonicalJson(value: unknown): string`; `hashPayload(payload): string` = sha256 hex de `canonicalJson(payload sem updatedAt)`.

Campos por kind = as colunas que `prepareWrite().insert` grava, com as mesmas expressões (`?? null`, `moneyText`, `transactionDetails`), mais o id do pai: `project_column`/`project_link` levam `projectId`; `goal_entry` leva `goalId`; `habit_completion` tem id `<habitId>:<data>` e payload `{ habitId, date }`; filhos de tabela financeira levam `tableId`; `yield_entry` leva `tableId` **e** `sourceId`; `financial_debt` vem de `lists[].debts[]` com os campos do tipo `FinancialDebt`; `financial_profile` vem de `financialProfiles[]` com os campos do tipo; `financial_table` leva `name`, `currency`, `createdAt`, `updatedAt`, `profileId`, `provider`, `actualBalance`, `actualBalanceUpdatedAt`, `legacyFinancialMetadata`; `transaction` leva os campos de `record_metadata` como chaves próprias. `task.tags` e `note.connections` são ordenados. Ausente e `undefined` viram `null`.

- [ ] Passo 1: testes:
  - Um `SaveData` com 1 projeto (2 colunas, 1 link, 1 caminho de código), 1 tarefa, 1 hábito com 2 dias, 1 tabela com 1 transação, 1 item, 1 meta, 1 dívida, 1 fonte e 1 lançamento de rendimento produz a contagem esperada por kind (project 1, project_column 2, project_link 1, task 1, habit 1, habit_completion 2, financial_table 1, transaction 1, shopping_item 1, financial_goal 1, financial_debt 1, yield_source 1, yield_entry 1).
  - O payload de `project` não tem `columns`, `links`, `codePaths`, `activeCodePathIds` nem `activeCodePathId`; mudar `codePaths` + `updatedAt` do projeto não muda o hash.
  - Mudar só `updatedAt` de uma tarefa, hábito, meta ou tabela não muda o hash; mudar `title`/`name` muda.
  - `description: undefined`, `description: null` e campo ausente → mesmo hash.
  - Transação com `amount: 1500.5` e com `amount: '1500.5'` → mesmo hash.
  - Um campo extra que o SQLite não guarda (ex.: `foo: 1` na tarefa) não muda o hash.
  - `tags: ['b','a']` e `['a','b']` → mesmo hash.
  - Mudar `transactions[0].amount` muda só o hash da transação.
  - `extractMemoryRecords`: mudar `accessCount` ou `lastAccessedAt` não muda o hash; mudar `archivedAt` muda.
  - `canonicalJson({ b: 1, a: { d: 2, c: 3 } })` === `'{"a":{"c":3,"d":2},"b":1}'`.
- [ ] Passo 2: `npx vitest run src/main/__tests__/sync-records.test.ts`. Esperado: FALHA.
- [ ] Passo 3: mova os dois helpers e implemente `sync-records.ts`.
- [ ] Passo 4: `npx vitest run src/main/__tests__/sync-records.test.ts src/main/__tests__/store.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): registros sincronizáveis com hash canônico`.

### Task 4: plano de mudanças e linhas a gravar

**Arquivos:** Criar `src/main/modules/sync/sync-plan.ts` · Teste `src/main/__tests__/sync-plan.test.ts`
**Interfaces:** Consome `SyncRecord`, `SyncKind`, `DATA_KINDS`, `MEMORY_KINDS`, `nextHlc`. Produz:
- `interface StoredVersion { kind: SyncKind; id: string; hash: string; deleted: boolean }`
- `interface SyncScope { kinds: readonly SyncKind[]; complete: boolean; removedIds?: { kind: SyncKind; id: string }[] }`
- `interface SyncPlan { upserts: SyncRecord[]; deletes: StoredVersion[] }` — o delete leva a versão guardada, então o hash anterior vem dela.
- `planSyncChanges(records: SyncRecord[], stored: StoredVersion[], scope: SyncScope): SyncPlan`
- `interface SyncRow { kind: SyncKind; id: string; hlc: string; deviceId: string; hash: string; deleted: boolean; seq: number }`
- `buildSyncRows(plan: SyncPlan, state: { maxHlc: string | null; maxSeq: number }, deviceId: string, nowMs: number): SyncRow[]` — HLC e `seq` crescem a cada linha.

Regras de `planSyncChanges`: `upserts` = registros sem versão, com hash diferente ou com versão `deleted`. `deletes` = com `complete`, toda versão viva de um kind do escopo ausente de `records`; sem `complete`, só os `removedIds` com versão viva. Nada fora de `scope.kinds` entra.

- [ ] Passo 1: testes:
  - Sem versões guardadas → todo registro em `upserts`, `deletes` vazio.
  - Mesmos registros e hashes → plano vazio.
  - Transação nova numa tabela existente → `upserts` só com ela.
  - Tabela removida com 3 transações → `deletes` com a tabela e as 3 transações, cada uma com o hash guardado.
  - Versão `deleted` cujo registro voltou → `upserts`.
  - `complete: true` com `DATA_KINDS` nunca gera delete de `memory`.
  - `complete: false` com `MEMORY_KINDS` e 1 registro: as outras memórias não viram delete; `removedIds: [{ kind: 'memory', id: 'm2' }]` gera exatamente esse delete.
  - Delete de algo já `deleted` → não entra.
  - Dois `SaveData` que diferem só em timer, tema, perfil ativo, caminho de código e `updatedAt` do projeto, passados por `extractDataRecords` → plano vazio.
  - `buildSyncRows` com 2 upserts e 1 delete e `{ maxHlc: null, maxSeq: 0 }`: `seq` 1, 2, 3; HLCs estritamente crescentes; o delete com `deleted: true` e o hash guardado. Com `{ maxHlc: <hlc futuro>, maxSeq: 10 }`: começa em `seq` 11 e com HLC maior que `maxHlc`.
- [ ] Passo 2: `npx vitest run src/main/__tests__/sync-plan.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente em `sync-plan.ts`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): plano de versões a partir do hash`.

### Task 5: tabela, captura no salvamento e reconciliação na abertura

**Arquivos:** Modificar `src/main/store.ts` · Modificar `src/main/modules/logs/logger.ts` (`LogArea` ganha `'sync'`) · Modificar `src/main/modules/agent/sagyou-mcp.ts` (enum `area` de `read_logs` ganha `'sync'`) · Teste `src/main/__tests__/logger.test.ts` e `src/main/__tests__/sagyou-mcp.test.ts`
**Interfaces:** Consome Tasks 1–4.

Em `store.ts`:
- `migrateSyncRecordsTable(db)` logo depois de `initSchema(_db)` (tabela e dois índices, idempotente).
- `captureSyncVersions(db, records, scope)`: lê `SELECT kind,id,hash,deleted FROM sync_records` filtrado pelos kinds do escopo, `SELECT MAX(hlc), MAX(seq)`, chama `planSyncChanges` + `buildSyncRows` e grava cada linha com `INSERT … ON CONFLICT(kind,id) DO UPDATE SET hlc, device_id, hash, deleted, seq`. Se levar mais de 50 ms: `log.info('sync', 'capture_slow', { ms, records })`.
- `getSyncDeviceId()`: cache em módulo; `loadOrCreateDeviceId(app.getPath('userData'), is.dev ? SYNC_DEVICE_FILE_DEV : SYNC_DEVICE_FILE, reason => reason === 'missing' ? log.info('sync', 'device_id_created') : log.warn('sync', 'device_id_reset'))`.
- `reconcileSyncRecords(db)` em `getDb()` depois de `migrateFromJson(_db)`, cada parte num `try/catch` próprio que loga `log.error('sync', 'reconcile_failed', { scope, msg })` e deixa o app abrir (resposta à checagem, item 3):
  - **dados**: se não há nenhuma linha com `kind != 'memory'`, captura `extractDataRecords(loadData(db))` com `{ kinds: DATA_KINDS, complete: true }`. Se já há, não faz nada (o próximo `saveData` cobre).
  - **memórias**: sempre captura todas as memórias de `memory` (arquivadas incluídas, lidas com `memRowToMemory`) com `{ kinds: MEMORY_KINDS, complete: true }`. Como o hash não muda sem edição, uma abertura normal não grava nada; uma carga interrompida ou que falhou se completa.
  - Loga `log.info('sync', 'reconcile', { data: n, memory: m })` com as linhas gravadas.
- `saveData`: dentro da transação existente, depois de `persistDiff`/`persistAll`: `try { db.transaction(() => captureSyncVersions(db, extractDataRecords(next), { kinds: DATA_KINDS, complete: true }))() } catch (err) { log.error('sync', 'capture_failed', { msg: errorMessage(err) }) }`.

- [ ] Passo 1: testes: `logger.test.ts` grava e lê uma entrada com `area: 'sync'`; `sagyou-mcp.test.ts` confirma que o schema de `read_logs` aceita `area: 'sync'`.
- [ ] Passo 2: `npx vitest run src/main/__tests__/logger.test.ts src/main/__tests__/sagyou-mcp.test.ts`. Esperado: FALHA (`'sync'` não é área válida).
- [ ] Passo 3: implemente as mudanças em `logger.ts`, `sagyou-mcp.ts` e `store.ts`. O SQL de `captureSyncVersions` e `reconcileSyncRecords` não roda no vitest; é verificado na Task 7.
- [ ] Passo 4: `npx vitest run src/main/__tests__ && npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): versões gravadas a cada salvamento`.

### Task 6: versões das memórias

**Arquivos:** Modificar `src/main/modules/sync/sync-plan.ts` · Modificar `src/main/store.ts` · Teste `src/main/__tests__/sync-plan.test.ts`
**Interfaces:** Produz `memoryCaptureScope(op: 'upsert' | 'archive' | 'delete' | 'replace' | 'scrub', ids: string[]): SyncScope`. Consome `captureSyncVersions`, `extractMemoryRecords`.

`store.ts` usa `memoryCaptureScope` em cada escrita de memória, dentro da transação da função, num savepoint com o mesmo `try/catch` de `saveData`: `upsertMemory` captura `[m]` com `'upsert'`; `archiveMemories` relê as linhas arquivadas e captura com `'archive'`; `deleteMemory` captura `[]` com `'delete'`; `replaceMemories` captura todas as gravadas com `'replace'`; `scrubMemoryConversationLinks` captura as reescritas com `'scrub'`. `touchMemories` não muda.

- [ ] Passo 1: testes de `memoryCaptureScope`: `'upsert'`, `'archive'` e `'scrub'` → `{ kinds: MEMORY_KINDS, complete: false }` sem `removedIds`; `'delete', ['m2']` → `complete: false, removedIds: [{ kind: 'memory', id: 'm2' }]`; `'replace'` → `complete: true`. E, combinando com `planSyncChanges`: duas memórias guardadas, `'upsert'` de uma só → nenhum delete; a mesma memória com `accessCount + 1` → plano vazio; com `archivedAt` preenchido → um upsert.
- [ ] Passo 2: `npx vitest run src/main/__tests__/sync-plan.test.ts`. Esperado: FALHA (`memoryCaptureScope` não existe).
- [ ] Passo 3: implemente `memoryCaptureScope` e as chamadas em `store.ts`.
- [ ] Passo 4: `npx vitest run src/main/__tests__ && npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): versões das memórias`.

### Task 7: suíte completa, verificação no app, documentação e PR

**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md` (README sem mudança: nada visível).

- [ ] Passo 1: `npm run typecheck && npm run lint && npm test`. Esperado: tudo verde, nenhum erro novo de lint.
- [ ] Passo 2: verificação no app (`better-sqlite3` não roda no vitest). Com uma **cópia** de um `kanban.db` real como `kanban-dev.db`, rode `npm run dev` e confira com `sqlite3`, anotando `MAX(seq)` antes de cada passo:
  - Primeira abertura: `SELECT kind, COUNT(*) FROM sync_records GROUP BY kind` bate com as tabelas (`projects`, `project_columns`, `tasks`, `transactions`, `habit_completions`, `memory`…); `sync-device-dev.json` existe; o log tem `sync`/`device_id_created` e `sync`/`reconcile`.
  - **Só mudar o tema** (isso dispara um salvamento completo): `MAX(seq)` não muda. Se mudar, a forma canônica tem divergência: liste `SELECT kind, COUNT(*) … WHERE seq > <antes> GROUP BY kind` e corrija na Task 3 antes de seguir.
  - Fechar e abrir de novo: `MAX(seq)` não muda.
  - Mudar o perfil financeiro ativo e trocar o caminho de código de um projeto: `MAX(seq)` não muda.
  - Lançar uma transação: `MAX(seq)` aumenta em exatamente 1, e a linha nova é `transaction`.
  - Marcar um hábito: exatamente 1 linha nova, `habit_completion`.
  - Iniciar um timer: `MAX(seq)` não muda. Parar: exatamente 1 linha nova, a `task`.
  - Excluir uma tarefa: exatamente 1 linha alterada, `deleted = 1`.
  - Arquivar uma memória: 1 linha `memory` com `seq` novo; buscar memórias não muda `MAX(seq)`.
  - Importar um backup do próprio banco: nenhum erro `sync` no log; nenhum `capture_slow` acima de 200 ms.
- [ ] Passo 3: `CLAUDE.md`: na tabela de `userData`, a linha `sync-device.json`; na seção do `store.ts`, um parágrafo sobre `sync_records` (fora de `persistAll`/`persistDiff`, forma de linha persistida + hash sem `updatedAt`, captura num savepoint, reconciliação na abertura, módulo `modules/sync/`); na lista de áreas do log, `sync`. `GUIDE.md`, em "Regras que quebram dados": `sync_records` nunca é apagada pelo salvamento, o id do aparelho nunca vai para backup, e um campo novo persistido precisa entrar na lista de campos do kind em `sync-records.ts`.
- [ ] Passo 4: commit `docs(sync): registro de versões`.
- [ ] Passo 5: `/sagyou-review` e depois `/sagyou-pr` (o PR diz: mudança aditiva, sem migração destrutiva; tabela e arquivo novos fora do backup).
