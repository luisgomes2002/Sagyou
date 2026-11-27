# Plano de implementação: Limpeza geral do código morto e dos formatos legados

Status: draft
Spec: docs/specs/2026-11-27-limpeza-geral-legado.md
Branch: feature/limpeza-geral-legado

**Objetivo:** remover o código morto e os formatos legados que os aparelhos atuais não usam, em um PR com um commit por limpeza, sem apagar dado do usuário e sem quebrar backups 1 a 7.
**Arquitetura:** só remoções e simplificações sobre o `main` 1.14.0. Cada task é independente e deixa o app compilando e os testes verdes. O que fica por compatibilidade com arquivos antigos (grupo C da spec) ganha um teste que o trava. Os PRs #71 e #72 são só referência: nada é cherry-picked, porque o `main` mudou `index.ts`, `agent-briefing.ts` e `terminal-handoff.ts`.

## Restrições Globais
- Testes, typecheck e lint **rodam só no CI** (regra do dono). Onde um passo diz "rode", leia "o CI roda depois do push"; o teste que falha vem sempre **antes** da remoção no mesmo commit, e o push é feito uma vez, no fim de cada grupo (A, B, C+final), para ler o CI.
- Sem `--no-verify`, sem force-push, nunca commitar em `main`. Commits `chore(<escopo>): …` ou `refactor(<escopo>): …`, uma limpeza por commit, com `Co-Authored-By`.
- Nenhuma coluna SQLite é apagada, e a única tabela apagada é `entity_events` (Task 15, commit próprio). Nenhum arquivo do usuário em `userData` é lido, movido ou apagado: `skills/`, `ai-templates.json`, `legacy-chat-state.json`, `backups/pre-remocao-chat-*`.
- `packages/core/src/__tests__/fixtures/sync-vectors.json` só é alterado na Task 10, nos registros `financial_table` que traziam `legacyFinancialMetadata` (decisão do dono, 2026-11-27), **regenerado com `apps/desktop/scripts/gen-sync-vectors.ts` e nunca editado à mão**; o resto do arquivo fica byte a byte igual e o diff é revisado.
- O `core` não importa Node (`no-node.test.ts`).
- Backup aceita as versões 1 a 7; `conversations`/`chatImages`, `dataUrl` inline, conversão de dinheiro `number` → texto, `migrateYieldSummaryDates` e `taskId` singular das notas **continuam**, mas a partir da Task 12 só dentro de `backup-compat.ts`, chamado pela importação.
- A trava de escrita do `ai-config.json` (as 14 chaves aposentadas) **continua**, em `modules/ai/ai-config.ts`.
- `confineToRoot` continua com o mesmo corpo e os mesmos testes **até a Task 13 provar que não tem chamador** (aí o módulo e o teste saem); `external-links.ts` e `safeExternalUrl` ficam.
- Versão: `apps/desktop/package.json` e o `package-lock.json` vão a **1.15.0**; o celular vai a **0.10.1** (o `core` roda no app).
- Atualizar `CLAUDE.md` e `GUIDE.md` junto de cada task que muda o que descrevem; `README.md` só se citar o removido.
- Textos de UI, se algum aparecer: pt-BR; nenhum texto novo está previsto.
- `ai:code-agent:run` "não aceita mais" um campo = **ignora** o campo (um objeto com chave extra não é recusado).
- Cada commit deixa o typecheck verde: com `noUnusedLocals` ligado, todo import que a remoção deixar sem uso sai no mesmo commit.

## Desvios da spec (decisão do construtor, a confirmar na aprovação do plano)
1. **`legacyFinancialMetadata` é apagado por completo, inclusive do sync** (pedido do dono). `sync/records.ts` o põe no payload e no hash do record `financial_table`, `conflict-view.ts` o rotula e três vetores pinados o trazem; por isso a Task 10 tira o campo do `records.ts`, do `conflict-view.ts`, do tipo, do `store.ts` e dos testes do celular, e **regenera só os registros afetados** do `sync-vectors.json` com o script gerador, revisando o diff. Efeito real: o hash muda apenas para tabelas que traziam o campo (nos bancos conferidos, só as de teste); cada aparelho cria uma única versão nova delas.
2. **`codeHarness: 'sagyou'` → `codex`** continua, numa linha, dentro de `modules/ai/ai-config.ts` (função exportada `agentOnlyConfig`). Sem ela, o renderer receberia `'sagyou'` de `ai:config:get`.
3. **Leitura do `activeCodePathId` singular:** continua **só** em `normalizeProject`/`activeCodePathIds(project)` do core (backups 1 a 7). `normalizeProject` devolve o projeto **sem** a chave singular. `rc-manager`, `agent-session-root`, `excelExport` e o `INSERT` de `store.ts` passam a ler só a lista (eles recebem projeto já normalizado ou lido do banco); os tipos estruturais `SessionProject` e o de `projectServerPath` perdem o campo singular.
4. **`mcp-external.ts` já ignora** `expiresAt`, `projectId`, `financialProfileId` e `mode` (e o teste `writeLegacyFile` já cobre): não há leitura a remover, só texto de `CLAUDE.md` e comentários.
5. **Conversões do banco** (`migrateMoneyColumnsToText`, `migrateMemoryDropProjectFk`, `migrateTaskImagesToDisk`): saem sem guarda, porque todos os aparelhos já passaram por elas. Risco aceito e registrado: um banco que ainda tivesse colunas `REAL` ou o FK em cascata voltaria ao comportamento antigo.
6. **A linha `settings.activeTimer`** de bancos existentes fica no banco, sem leitura (`persistAll` esvazia `settings` no primeiro save).
7. **Emenda de escopo (pedido do dono):** as Tasks 12 a 16 adaptam o que fica (camada única de compatibilidade de backup, nomes, docs) e removem a sobra (campos vazios das runs, `code-files.ts`, `sourceConversationId`, tabela `entity_events`). Na Task 8 o `activeCodePathIds()` do core deixa de ler o singular quando a Task 12 move essa leitura para `backup-compat.ts`; a Task 8 só tira a **escrita** do espelho.

## Foco de Review
1. **Backup antigo continua entrando.** Um backup com só `activeCodePathId` singular vira lista de pastas; um com `conversations`/`chatImages` importa ignorando-os; um com `budgets`/`recurringTransactions` importa sem erro. Testado nas Tasks 8, 10 e 11 (`kanban.test.ts` e o novo `packages/core/src/__tests__/normalization.test.ts`).
2. **Timer e pasta de código de quem já usa o app.** `normalizeTimers` e `normalizeProject` devolvem a lista; o round-trip do `kanban.ts` (com `ElectronStorage` mockado) não perde seleção nem timer. O `store.ts` **não roda sob vitest** (`better-sqlite3`): a leitura e a escrita no SQLite são conferidas por revisão do diff e pela verificação no app (Task 13). Testado nas Tasks 7 e 8.
3. **Sync muda só onde o dono autorizou.** O hash de um projeto não muda com ou sem o campo singular; o hash de uma `financial_table` **sem** `legacyFinancialMetadata` é o mesmo de antes; o diff do `sync-vectors.json` toca somente os registros que traziam o campo; `sync-vectors.test.ts` passa depois. Testado nas Tasks 9 e 10.
4. **Nada de segurança some junto.** `confineToRoot` (mesmos casos), a trava das 14 chaves de `ai:config:set` e `safeExternalUrl` continuam testados. Testado nas Tasks 1, 2 e 5.
5. **Sessão do Fleet abre igual.** O lado do renderer (`FleetView` não envia `task` nem `blank`) e a lista de canais removidos são testados (Task 4). **Os argumentos do CLI e o MCP escopado de `ai:code-agent:run` não têm teste automático** (o handler está em `index.ts`): ficam para o review (diff de `launch.args`, `prepareAgentMcpSession` intocado) e para a verificação no app da Task 13.
6. **A carga do banco ficou só com o modelo atual.** `loadData` com dado atual não muda nada, e o dado antigo só entra por `importBackup` via `upgradeLegacyBackup`. Os casos de dinheiro, pasta, nota e datas de rendimento têm teste de importação. Testado na Task 12.
7. **A tabela `entity_events` e `code-files.ts` só saem depois de provado que ninguém os usa.** `grep` sem chamador antes de apagar; backup do `kanban.db` antes de abrir o app novo. Tasks 13 e 15.

### Task 1: Limpeza 1 — canais IPC sem chamador
**Arquivos:** Apagar `apps/desktop/src/main/handlers/code-files.ts`; Modificar `apps/desktop/src/main/modules/code/code-files.ts` (fica só `confineToRoot`, mesmo corpo), `src/main/index.ts` (imports `codeFiles`, `codeFileFs`, `registerCodeFilesHandlers`, o handler `ai:lineage:list`, e `eventsForEntity` do import), `src/main/handlers/files.ts` (handler `ai:project-file:read` e imports `extname`, `isDocumentExt`, `parseDocument`), `src/main/store.ts` (`eventsForEntity`), `src/preload/index.ts` (blocos `lineage`, `code`, `projectFile`); Teste `src/main/__tests__/handlers.test.ts` (tirar o `describe('ai:code:* handlers')`, os três canais da lista e o import `mkdir` se sobrar sem uso; acrescentar o teste de canais removidos), `src/main/__tests__/code-files.test.ts` (fica só `confineToRoot`).
**Interfaces:** Produz `confineToRoot(root: string, rel: string): string | null` inalterado. Consome nada.
- [ ] Passo 1: em `handlers.test.ts`, escreva `it('no longer registers the channels nothing in the renderer called')` afirmando que `ai:code:list`, `ai:code:read`, `ai:code:search`, `ai:project-file:read` e `ai:lineage:list` **não** estão em `handlers`.
- [ ] Passo 2: rode o teste. Esperado: FALHA porque os cinco canais ainda são registrados.
- [ ] Passo 3: remova os handlers, o preload e `eventsForEntity`; reduza `code-files.ts` a `confineToRoot` e `code-files.test.ts` aos casos de `confineToRoot`.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/handlers.test.ts src/main/__tests__/code-files.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove canais IPC sem chamador (limpeza 1)`

### Task 2: Limpeza 2 — web-fetch e web-render
**Arquivos:** Apagar `src/main/modules/web/web-fetch.ts`, `src/main/modules/web/web-render.ts`, `src/main/__tests__/web-fetch.test.ts`, `src/main/__tests__/web-render.test.ts`; Modificar `src/main/index.ts` (imports `fetchWeb`/`renderWeb` e o handler `ai:web:fetch`), `src/preload/index.ts` (bloco `web`), `.claude/agents/sagyou-security-reviewer.md` (linha "Web" vira "Links externos"), `CLAUDE.md`/`GUIDE.md` (saem as seções de SSRF e render; fica um parágrafo dizendo que a política está no histórico do git).
**Interfaces:** `safeExternalUrl` em `modules/web/external-links.ts` fica, sem mudança.
- [ ] Passo 1: acrescente `'ai:web:fetch'` à lista do teste de canais removidos da Task 1.
- [ ] Passo 2: rode o teste. Esperado: FALHA porque `ai:web:fetch` ainda é registrado.
- [ ] Passo 3: remova os módulos, o handler e o preload; ajuste o exemplo de comando do `GUIDE.md` para `external-links.test.ts`.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/handlers.test.ts src/main/__tests__/external-links.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove web-fetch e web-render (limpeza 2)`

### Task 3: Limpeza 4 — WebStorage
**Arquivos:** Apagar `src/renderer/src/services/WebStorage.ts` e `src/renderer/src/__tests__/services/WebStorage.test.ts`; Modificar `CLAUDE.md` (parágrafo do `IStorageAdapter`: só `ElectronStorage`; a frase "so `WebStorage` implements them too").
**Interfaces:** `IStorageAdapter` fica, como costura de teste.
- [ ] Passo 1: nada novo a testar (a remoção só apaga um arquivo sem referência); confirme com `grep -rn WebStorage` que o único uso era o próprio teste.
- [ ] Passo 2: sem teste falhando; o guarda é o typecheck do CI.
- [ ] Passo 3: apague os dois arquivos e ajuste o `CLAUDE.md`.
- [ ] Passo 4: o typecheck do CI deve passar sem o arquivo.
- [ ] Passo 5: commit `chore(desktop): remove WebStorage (limpeza 4)`

### Task 4: Limpeza 3 — Skills do Sagyou e briefing de pedido inicial
**Arquivos:** Apagar `src/main/modules/ai/skills.ts`, `src/main/modules/agent/agent-briefing.ts`, `src/main/__tests__/agent-briefing.test.ts` (e o teste de skills, se existir); Modificar `src/main/index.ts` (imports de `skills` e de `agent-briefing`; as funções `readOnlyReferenceBrief`, `sagyouContextBrief`, `sagyouSkillsBrief`; `skillsPath` e a migração de `ai-templates.json`; os handlers `ai:skills:*`; no handler `ai:code-agent:run`, os parâmetros `task`, `blank`, `files`, `readOnlyRoots`, `decisoes`, `coordinated`, a recusa `'Tarefa vazia'`, a variável `droppedFiles`, a montagem do briefing, a busca de memórias e de handoffs que só o briefing usava, e os banners dos arquivos indicados; `launch` passa a ser `buildTerminalHarnessLaunch(harness, '', effectiveDir)` e `baseExternalArgs = launch.args`; o objeto da run grava `task: BLANK_SESSION_TASK`, `decisions: []`, `readOnlyRoots: []`; o `subject` do handoff vira `activity.subject`), `src/preload/index.ts` (tipo `Skill`, bloco `skills`, request de `codeAgent.run`), `src/renderer/src/components/ai/FleetView.tsx` (a chamada sem `task` e `blank`), `src/main/modules/agent/terminal-handoff.ts` (comentários), `CLAUDE.md`/`GUIDE.md`.
**Imports que podem ficar sem uso em `index.ts` (confira cada um com `grep` antes de tirar; alguns têm outro uso):** `taskLabel`, `resolve`, `listSkills`, `saveSkill`, `deleteSkill`, `skillsDir`, `buildExternalAgentBrief`, `scrubExternalBriefSecrets`, `withoutRunningHandoffs`, `memoryRules`, `searchScopeFor`, `readFile`, `renameSync`, `ReadOnlyRoot`.
**Interfaces:** `ai:code-agent:run` lê só `path`, `allowedWritePaths`, `sessionId`, `projectId`, `financialProfileId`, `autoApprove` (os outros campos são ignorados). `CodeRunState` e o arquivo de runs mantêm `decisions`, `readOnlyRoots`, `localSkills` (vazios ou só por detecção). `userData/skills/` não é lida.
- [ ] Passo 1: em `handlers.test.ts`, acrescente os quatro `ai:skills:*` ao teste de canais removidos. Em `FleetView.test.tsx`, nos **dois** testes de abertura de sessão, troque a asserção por `objectContaining({ path: …, projectId: … })` e acrescente `expect(sent).not.toHaveProperty('task')` e `('blank')`.
- [ ] Passo 2: rode os dois arquivos. Esperado: FALHA porque os canais existem e o `FleetView` ainda envia `task` e `blank`.
- [ ] Passo 3: faça as remoções acima.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/handlers.test.ts src/renderer/src/__tests__/components/FleetView.test.tsx`. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove Skills do Sagyou e o briefing de pedido inicial (limpeza 3)`

### Task 5: Limpeza 5 — migração do chat legado
**Arquivos:** Apagar `src/main/handlers/legacy-chat.ts`, `src/main/modules/ai/legacy-chat-removal.ts`, `src/main/modules/ai/legacy-chat-state.ts`, `src/main/modules/conversations/legacy-ai-data.ts`, `src/main/__tests__/legacy-chat-handlers.test.ts`, `legacy-chat-removal.test.ts`, `legacy-chat-state.test.ts`, `legacy-ai-data.test.ts`; Criar `src/main/modules/ai/ai-config.ts` (as 14 chaves `LEGACY_API_CONFIG_KEYS`, `stripLegacyApiConfig` e `agentOnlyConfig`, copiados de `legacy-chat-removal.ts` e do `index.ts`; `agentOnlyConfig` mantém a linha `codeHarness: 'sagyou'` → `'codex'`) e `src/main/__tests__/ai-config.test.ts`; Modificar `src/main/index.ts` (a abertura que chama a migração antes de `createWindow`, `legacyState`, `registerLegacyChatHandlers`, o `agentOnlyConfig` privado, e **todos os usos de `convId`**: o tipo da run, o arquivo de runs e o handler de runs), `src/preload/index.ts` (`legacyChat`, `convId` de `AgentRunMeta`), `src/renderer/src/components/ai/FleetView.tsx` (o aviso do chat removido), `src/renderer/src/components/ai/fleet/useCodeAgentRuns.ts` (`convId`), `src/main/modules/agent/agent-runs.ts` (`convId` do tipo, de `normalizeRuns` e de `runsForSession`; a chave de poda vira `r.sessionId ?? '__none__'`), `src/main/store.ts` (`scrubMemoryConversationLinks`), `src/main/__tests__/handlers.test.ts` (o `describe('legacy chat removal on startup')`, o setup `startupOrder` e a migração mockada; **o teste "turns a legacy sagyou harness into codex on read" fica**), `src/main/__tests__/agent-runs.test.ts`, `src/renderer/src/__tests__/components/FleetView.test.tsx` (os testes do aviso: `legacyChat.notice`/`dismiss`), `CLAUDE.md` (a seção "Remoção do chat genérico" vira um parágrafo histórico), `GUIDE.md`, `docs/data-migrations.md` (nota: o código saiu na 1.15.0).
**Interfaces:** `stripLegacyApiConfig(value: unknown): { config: Record<string, unknown>; changed: boolean }` (a assinatura de hoje); `agentOnlyConfig(value: unknown): Record<string, unknown>` = `stripLegacyApiConfig(normalize(value)).config`, onde `normalize` troca `'sagyou'` por `'codex'`; `runsForSession(runs, sessionId)` casa só por `sessionId`.
- [ ] Passo 1: em `ai-config.test.ts`, escreva: (a) `stripLegacyApiConfig` remove as 14 chaves, devolve `changed: true` e preserva uma chave desconhecida; sem chave aposentada devolve `changed: false`; (b) `agentOnlyConfig({ codeHarness: 'sagyou', apiKey: 'x', foo: 1 })` devolve `{ codeHarness: 'codex', foo: 1 }`. Em `agent-runs.test.ts`, escreva: uma linha antiga só com `convId` e sem `sessionId` **não** é devolvida por `runsForSession`, e a poda por sessão não lança.
- [ ] Passo 2: rode os três arquivos. Esperado: FALHA porque `ai-config.ts` não existe e `runsForSession` ainda casa por `convId`.
- [ ] Passo 3: crie `ai-config.ts`, troque os imports, apague os módulos e testes da migração, e ajuste `agent-runs.ts`, o preload e o renderer.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/ai-config.test.ts src/main/__tests__/agent-runs.test.ts src/main/__tests__/handlers.test.ts src/renderer/src/__tests__/components/FleetView.test.tsx`. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove a migração do chat legado e o convId das runs (limpeza 5)`

### Task 6: Gravação de `entity_events`, `migrateFromJson` e arquivo de build versionado
**Arquivos:** Modificar `src/main/store.ts` (`diffEvents`, `appendEventRows`, `trimEventLog`, `EVENT_LOG_MAX` e a chamada na gravação; `migrateFromJson`, `LEGACY_PATH`; o campo `entityEvents` do `SaveData` e o tipo `EntityEvent` se ficarem sem uso; a tabela e o índice ainda ficam no `CREATE TABLE IF NOT EXISTS`, até a Task 15), `src/renderer/src/services/*` (campo `entityEvents`, se houver), `.gitignore` (`*.tsbuildinfo`); `git rm --cached` dos `*.tsbuildinfo` versionados em `apps/desktop/`.
**Interfaces:** o SQL do `CREATE TABLE entity_events` não muda nesta task.
- [ ] Passo 1: **não há teste automático possível**: `store.ts` não carrega sob vitest (`better-sqlite3` é compilado para o Electron, como o `store.test.ts` explica). A prova é o typecheck do CI (nenhum símbolo removido ainda referenciado), a leitura do diff e a verificação no app da Task 13 (salvar uma task e conferir que `entity_events` não ganha linhas).
- [ ] Passo 2: sem teste falhando; registre isso no corpo do commit.
- [ ] Passo 3: remova a gravação e `migrateFromJson`; deixe a tabela (a Task 15 a apaga); ignore e desversione os `*.tsbuildinfo`.
- [ ] Passo 4: o CI roda typecheck e a suíte inteira. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): para de gravar entity_events e remove migrateFromJson (limpeza 8a)`

### Task 7: Espelho do cronômetro (`activeTimer`)
**Arquivos:** Modificar `src/main/store.ts` (`writeTimers` grava só `activeTimers`; `loadData` lê só `activeTimers` e para de devolver `activeTimer`; `timersChanged` compara só o array; o tipo `SaveData`), `packages/core/src/normalization.ts` (`normalizeTimers` aceita só a lista), `src/renderer/src/services/StorageAdapter.ts` e `ElectronStorage.ts` (campo `activeTimer`), `src/renderer/src/store/kanban.ts` (o `activeTimer: activeTimers[0] ?? null` ao salvar), `CLAUDE.md` (a seção "Timers are a collection" perde o espelho); Teste: criar `packages/core/src/__tests__/normalization.test.ts`; ajustar `src/renderer/src/__tests__/store/kanban.test.ts` (os casos do espelho, ~1644 e ~1728-1745, viram "um valor singular antigo é ignorado") e `src/main/__tests__/sync-apply.test.ts` (o `activeTimer` nos dados, ~237 e ~272).
**Interfaces:** `normalizeTimers(data: { activeTimers?: unknown }): ActiveTimer[]`. A linha `settings.activeTimer` de bancos existentes fica, sem leitura.
- [ ] Passo 1: em `normalization.test.ts`, escreva: `{ activeTimers: [{taskId:'t1', startedAt: 1}] }` devolve esse timer; `{ activeTimer: {taskId:'t1', startedAt: 1} }` devolve `[]`; um item sem `startedAt` numérico é descartado. Em `kanban.test.ts`: `loadData` → `_persist` com timers rodando grava `activeTimers` e **não** grava `activeTimer`.
- [ ] Passo 2: rode. Esperado: FALHA porque o singular ainda é aceito e gravado.
- [ ] Passo 3: remova o espelho.
- [ ] Passo 4: rode `npm test -w sagyou -- src/renderer/src/__tests__/store/kanban.test.ts src/main/__tests__/sync-apply.test.ts` e `npm test -w @sagyou/core`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(desktop): remove o espelho activeTimer (limpeza 8b)`

### Task 8: Espelho da pasta de código (`activeCodePathId`)
**Arquivos:** Modificar `packages/core/src/normalization.ts` (`withActiveCodePaths` devolve só `activeCodePathIds`; **`activeCodePathIds(project)` continua lendo o singular** para backups; `normalizeProject` devolve o projeto **sem** a chave `activeCodePathId`), `packages/core/src/types.ts` (o campo singular fica `@deprecated`, só leitura de backup), `src/main/store.ts` (a leitura de projeto, ~2810, devolve só `activeCodePathIds`; o `INSERT` de ~2352 usa `p.activeCodePathIds ?? []`), `src/main/modules/remote/rc-manager.ts` (`projectServerPath` e seu tipo estrutural), `src/main/modules/agent/agent-session-root.ts` (`SessionProject`) e `src/renderer/src/utils/excelExport.ts`: leem só a lista; `CLAUDE.md`/`GUIDE.md` ("Code path selection is a two-field pair" vira um campo); Teste: `packages/core/src/__tests__/normalization.test.ts` (da Task 7), `src/renderer/src/__tests__/store/kanban.test.ts` (as asserções `project().activeCodePathId`, ~1446-1538), `src/main/__tests__/rc-manager.test.ts` (o caso "cai no activeCodePathId legado", ~633, sai).
**Interfaces:** `withActiveCodePaths(ids: string[]): Pick<Project, 'activeCodePathIds'>`; `activeCodePathIds(project): string[]` lê a lista e, se não houver lista, o singular.
- [ ] Passo 1: escreva em `normalization.test.ts`: (a) `withActiveCodePaths(['a'])` devolve `{ activeCodePathIds: ['a'] }` sem a chave singular; (b) `normalizeProject` de um projeto **só com `activeCodePathId: 'a'`** (como um backup antigo) devolve `activeCodePathIds: ['a']` e **sem** a chave singular; (c) um projeto com lista vazia continua vazio, sem preencher com as pastas restantes (regra do `CLAUDE.md`); e atualize as asserções de `kanban.test.ts` para olhar só a lista.
- [ ] Passo 2: rode. Esperado: (a) e (b) FALHAM porque a chave singular ainda é escrita e mantida.
- [ ] Passo 3: remova a escrita do singular e troque as leituras diretas pela lista.
- [ ] Passo 4: rode os testes do core, `kanban.test.ts` e `rc-manager.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(core): remove o espelho activeCodePathId (limpeza 8c)`

### Task 9: Sync não muda (teste de contrato)
**Arquivos:** Criar `packages/core/src/sync/__tests__/records-contract.test.ts`; nada de produção.
**Interfaces:** consome `extractDataRecords(data: SyncSourceData): SyncRecord[]` e `hashPayload(payload: Record<string, unknown>): string` de `sync/records.ts`.
- [ ] Passo 1: escreva o teste: (a) o record `project` de um projeto com `activeCodePathIds` e `activeCodePathId` tem o **mesmo hash** que o do mesmo projeto só com `activeCodePathIds` (o hash de projeto nunca incluiu o singular); (b) o record `financial_table` de uma tabela **sem** `legacyFinancialMetadata` tem o hash que tinha antes da limpeza (valor copiado de um vetor que não traz o campo).
- [ ] Passo 2: rode `npm test -w @sagyou/core -- src/sync/__tests__/records-contract.test.ts`. Esperado: PASSA já (o campo singular é do aparelho, e a tabela sem o campo não muda). Se (a) FALHAR, **pare**: a Task 8 muda o contrato de sync e volta ao dono.
- [ ] Passo 3: sem código de produção.
- [ ] Passo 4: rode também `npm test -w sagyou -- src/main/__tests__/sync-vectors.test.ts` (o fixture não é regenerado). Esperado: PASSA.
- [ ] Passo 5: commit `test(core): o contrato de sync não depende dos espelhos legados`

### Task 10: Servidores RC, `legacyFinancialMetadata` (por completo) e conversões do banco
**Arquivos:** Modificar `src/main/modules/remote/remote-config.ts` (`legacyServerNames` e `migrateServerNames`; `loadRemoteConfig(dir, file)` deixa de ler `servers` por nome) e `src/main/index.ts` (o bloco que migra os nomes e o log `server_migrated`); **`legacyFinancialMetadata` em todos os lugares:** apagar `packages/core/src/financialLegacy.ts` e `src/renderer/src/utils/financialLegacy.ts`, tirar a chamada em `normalizeFinancialTable` (`packages/core/src/normalization.ts`), o campo de `packages/core/src/types.ts` (`FinancialTable`), a escrita e a leitura em `src/main/store.ts` (o `metadata` da tabela financeira e o `...ft.legacyFinancialMetadata`), a linha de `packages/core/src/sync/records.ts` (payload de `financial_table`) e as duas de `packages/core/src/sync/conflict-view.ts` (`FIELD_ORDER` e o rótulo "Dados antigos"); `src/main/store.ts` também perde `migrateMoneyColumnsToText`, `migrateMemoryDropProjectFk`, `migrateTaskImagesToDisk` e as chamadas em `getDb()` (os `ALTER TABLE … ADD COLUMN` **ficam**); `CLAUDE.md`/`GUIDE.md`/`docs/data-migrations.md`. **Fixture:** regenerar `packages/core/src/__tests__/fixtures/sync-vectors.json` com `apps/desktop/scripts/gen-sync-vectors.ts` depois de tirar a chave das entradas de teste do script. Testes: `src/main/__tests__/remote-config.test.ts`, `src/renderer/src/__tests__/store/kanban.test.ts` (~1109-1145), `src/renderer/src/__tests__/store/financial.test.ts` (~28 e ~167), `src/renderer/src/__tests__/utils/excelExport.test.ts` (~884), `packages/core/src/__tests__/finance-actions.test.ts` (~587-616), `packages/core/src/sync/__tests__/conflict-view.test.ts` (~127: o teste que exige rótulo para todo campo extraído deixa de ver este), `apps/mobile/src/store/__tests__/finance.test.ts` (~81 e ~160).
**Interfaces:** `FinancialTable` não tem `legacyFinancialMetadata`; `normalizeFinancialTable` descarta `budgets`, `recurringTransactions` e qualquer `legacyFinancialMetadata` que chegue; o payload de `financial_table` não tem a chave; `loadRemoteConfig` ignora `servers` por nome.
- [ ] Passo 1: escreva os testes: (a) `normalizeFinancialTable` de uma tabela com `budgets`, `recurringTransactions` e `legacyFinancialMetadata: { x: 1 }` devolve uma tabela **sem** nenhuma dessas chaves e não lança, e as demais regras (dinheiro texto, datas de rendimento) seguem; (b) o record `financial_table` extraído de uma tabela com o campo **não tem** a chave no payload; (c) `loadRemoteConfig` de um arquivo com `servers` por nome devolve `servers: []` e não lança.
- [ ] Passo 2: rode. Esperado: FALHA porque o campo ainda é preservado, ainda entra no payload e `legacyServerNames` ainda é lido; `sync-vectors.test.ts` também FALHA depois que o código muda e **antes** de o fixture ser regenerado, o que confirma que o contrato é o que se alterou.
- [ ] Passo 3: remova o que está listado; **instale as dependências só nesta etapa** (`npm ci`, que não toca o código) para rodar o gerador; regenere o fixture; `git diff packages/core/src/__tests__/fixtures/sync-vectors.json` deve mostrar mudanças **somente** nos registros `financial_table` que traziam o campo (e no lote selado, se ele os continha). Se o diff tocar qualquer outro vetor (hashes de task, nota, memória, códigos de recuperação), **pare**: a mudança vazou do escopo autorizado.
- [ ] Passo 4: rode `npm test -w @sagyou/core`, `npm test -w sagyou -- src/main/__tests__/sync-vectors.test.ts src/main/__tests__/remote-config.test.ts` e `npm test -w @sagyou/mobile`. Esperado: PASSA.
- [ ] Passo 5: commit `chore: apaga legacyFinancialMetadata do core, do sync e do desktop (limpeza 8d)`; e, num commit separado antes dele, `chore(desktop): remove formatos legados já migrados nos aparelhos` para os servidores RC e as conversões do banco.

### Task 11: Tolerância a backup antigo — teste que a trava
**Arquivos:** Teste `src/main/__tests__/backup-validation.test.ts` e o bloco de importação de backup de `src/renderer/src/__tests__/store/kanban.test.ts` (~1541); comentários curtos em `backup-validation.ts`, `handlers/backup.ts` e `slices/backup.ts` dizendo por que ficam.
**Interfaces:** nada novo.
- [ ] Passo 1: escreva os testes do grupo C: um backup versão 1 mínimo valida; um com `conversations` e `chatImages` valida e a importação não os repassa ao renderer; um com imagem de task inline (`dataUrl`) é convertida em arquivo; um com `budgets`/`recurringTransactions` importa; um projeto só com `activeCodePathId` singular importa com lista.
- [ ] Passo 2: rode. Esperado: PASSA já (é o que o código faz); se algum falhar, uma limpeza anterior quebrou a compatibilidade: corrija a task anterior.
- [ ] Passo 3: sem código de produção além dos comentários.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/backup-validation.test.ts src/renderer/src/__tests__/store/kanban.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `test(desktop): trava a compatibilidade com backups 1 a 7 (limpeza 8e)`

### Task 12: Camada única de compatibilidade de backup (adaptar)
**Arquivos:** Criar `packages/core/src/backup-compat.ts` e `packages/core/src/__tests__/backup-compat.test.ts`; Modificar `packages/core/src/normalization.ts` (`normalizeProject`, `normalizeFinancialTable`, o tratamento de notas: saem os ramos de dado antigo: singular de pasta, `number` → texto, `migrateYieldSummaryDates`, `taskId` singular das notas), `packages/core/src/memory.ts` (`scrubConversationLinks` passa para a camada), `apps/desktop/src/renderer/src/store/slices/backup.ts` (`importBackup` chama `upgradeLegacyBackup` antes dos normalizadores; a conversão de `dataUrl` de imagem continua aqui, porque usa IPC), `apps/desktop/src/renderer/src/store/kanban.ts` (carga sem os ramos antigos), `docs/data-migrations.md`, `CLAUDE.md`/`GUIDE.md`. Testes: `src/renderer/src/__tests__/store/kanban.test.ts` (os casos de dado antigo na **carga** passam a ser casos de **importação**) e `src/main/__tests__/backup-validation.test.ts` (a Task 11 vira o contrato desta camada).
**Interfaces:** `upgradeLegacyBackup(raw: Backup): Backup`, pura, sem Node, idempotente (chamar duas vezes dá o mesmo resultado). Consome os tipos de `types.ts`. Produz um `Backup` no modelo atual, que os normalizadores correntes já aceitam.
- [ ] Passo 1: em `backup-compat.test.ts`, escreva: (a) projeto só com `activeCodePathId: 'a'` → `activeCodePathIds: ['a']` e sem a chave singular; com lista e singular → fica a lista; lista vazia continua vazia; (b) nota com `taskId: 't'` e sem `taskIds` → `taskIds: ['t']`; (c) tabela com `budgets`, `recurringTransactions` ou `legacyFinancialMetadata` → sem essas chaves; (d) dinheiro `number` → texto decimal canônico, e texto canônico não muda; (e) resumo de rendimento no último dia do mês → primeiro dia, com o registro de auditoria que as regras de hoje exigem; (f) `conversations` e `chatImages` removidos; (g) memória com `sourceConversationId` e com a cauda "(conversa completa: id=…)" → sem o campo e sem a cauda; (h) idempotência. Em `kanban.test.ts`: `loadData` com dado **já atual** não muda nada; `importBackup` de um backup antigo produz o mesmo estado que hoje.
- [ ] Passo 2: rode. Esperado: FALHA porque `backup-compat.ts` não existe.
- [ ] Passo 3: crie a camada movendo (não reescrevendo) a lógica atual de cada ramo; faça a importação chamá-la; tire os ramos da carga. Se algum teste da carga ainda exigir o ramo antigo, ele passa a ser um teste da importação.
- [ ] Passo 4: rode `npm test -w @sagyou/core` e `npm test -w sagyou -- src/renderer/src/__tests__/store/kanban.test.ts src/main/__tests__/backup-validation.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(core): concentra a compatibilidade de backup antigo em backup-compat (limpeza 8f)`

### Task 13: Campos sempre vazios das runs e `code-files.ts` (remover a sobra)
**Arquivos:** Modificar `apps/desktop/src/main/index.ts` (`CodeRunState.allowedWritePaths`/`readOnlyRoots`/`decisions`, o parâmetro `allowedWritePaths` de `ai:code-agent:run` e o bloco que o valida, a passagem de `run.allowedWritePaths` a `validatePatchScope`, os campos do snapshot de runs, `decisions: [...run.decisions, ...activity.decisions]` → só `activity.decisions`, `ReadOnlyRoot`), `src/main/modules/agent/agent-runs.ts` (tipo e `normalizeRuns`: ignoram essas chaves em linhas antigas), `src/main/modules/agent/final-diff-review.ts` ou o módulo de `validatePatchScope` (o parâmetro, só se não tiver outro uso), `src/preload/index.ts` e `src/renderer/src/components/ai/fleet/useCodeAgentRuns.ts` (tipos), `CLAUDE.md`/`GUIDE.md`; Apagar `src/main/modules/code/code-files.ts` e `src/main/__tests__/code-files.test.ts` (sem chamador de `confineToRoot`). Teste: `agent-runs.test.ts` e o do módulo de escopo.
**Interfaces:** o arquivo de runs lido com `readOnlyRoots`/`allowedWritePaths`/`decisions` antigos devolve a run sem essas chaves. Antes de apagar `code-files.ts`, `grep -rn confineToRoot` tem de mostrar zero chamadores fora dele e do teste; se houver, a task para e volta ao dono.
- [ ] Passo 1: em `agent-runs.test.ts`, escreva: uma linha arquivada com `readOnlyRoots`, `allowedWritePaths` e `decisions` é lida sem essas chaves e continua listada pelo `sessionId`.
- [ ] Passo 2: rode. Esperado: FALHA porque `normalizeRuns` ainda as devolve.
- [ ] Passo 3: remova os campos, o parâmetro, o módulo e o teste; tire os imports sem uso.
- [ ] Passo 4: rode `npm test -w sagyou -- src/main/__tests__/agent-runs.test.ts` e o do módulo de escopo. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove campos sempre vazios das runs e code-files (limpeza 8g)`

### Task 14: `sourceConversationId` (remover a sobra)
**Arquivos:** Modificar `packages/core/src/types.ts` e `packages/core/src/memory.ts` (o campo, `sourceConversationId: null` nas duas fábricas), `apps/desktop/src/main/store.ts` (o `INSERT`/`UPDATE` de `memory` deixa de listar a coluna, que fica no banco com `NULL`; `migrateMemoryProvenanceColumn` fica, porque cria a coluna em banco novo; sai `scrubMemoryConversationLinks` se a Task 5 ainda não a tiver tirado), os testes de memória e de `graph-layout`/`MemoryView` que montam o campo, `apps/mobile/src` se algum teste montar o campo (só tipo), `CLAUDE.md`. 
**Interfaces:** `AiMemory` não tem mais `sourceConversationId`; `upgradeLegacyBackup` (Task 12) ainda remove a chave de memórias de backup antigo e de payloads de sync antigos.
- [ ] Passo 1: em `backup-compat.test.ts` (Task 12) o caso (g) já cobre a remoção da chave; adicione em `packages/core/src/__tests__/memory-handoff.test.ts` ou no teste de `buildMemory`: o objeto devolvido **não** tem a chave `sourceConversationId`.
- [ ] Passo 2: rode. Esperado: FALHA porque `buildMemory` ainda devolve `sourceConversationId: null`.
- [ ] Passo 3: remova o campo e ajuste os testes que o montam. `sync-vectors.json` **não** é alterado (a chave que ele traz em um registro de memória é ignorada pelo hash).
- [ ] Passo 4: rode `npm test -w @sagyou/core`, `npm test -w @sagyou/mobile` e `npm test -w sagyou -- src/main/__tests__/sync-vectors.test.ts`. Esperado: PASSA, e os vetores intactos.
- [ ] Passo 5: commit `chore(core): remove sourceConversationId das memórias (limpeza 8h)`

### Task 15: Tabela `entity_events` (⚠️ destrutiva, commit próprio)
**Arquivos:** Modificar `apps/desktop/src/main/store.ts` (o `CREATE TABLE`/índice saem do esquema; `migrateDropEntityEvents(db)` roda em `getDb()` depois das anteriores: `DROP TABLE IF EXISTS entity_events` e `DROP INDEX IF EXISTS idx_entity_events_entity`), `CLAUDE.md`/`GUIDE.md`/`docs/data-migrations.md` (⚠️ Breaking schema change — existing data may be affected: o diário de alterações é apagado).
**Interfaces:** idempotente, segura em banco novo, antigo e já migrado. Não toca nenhuma outra tabela.
- [ ] Passo 1: como `store.ts` não roda sob vitest, a prova é o typecheck do CI e a verificação no app (Task 18: abrir o app, salvar uma task, abrir de novo, conferir que `kanban.db` não tem a tabela e os dados estão intactos). Faça um **backup do `kanban.db`** antes de abrir o app novo pela primeira vez e anote isso no PR.
- [ ] Passo 2: sem teste falhando; registre no corpo do commit.
- [ ] Passo 3: acrescente a função e a chamada; tire o `CREATE TABLE`.
- [ ] Passo 4: o CI roda typecheck e a suíte. Esperado: PASSA.
- [ ] Passo 5: commit `chore(desktop): remove a tabela entity_events (limpeza 8i)`

### Task 16: Nomes e documentação (adaptar)
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external-policy.ts` (`LEGACY_CARD_WRITES` → `FLEET_CARD_WRITES` e o comentário), os testes que citam o nome, `docs/data-migrations.md` (a lista de pastas que podem ser apagadas à mão), `CLAUDE.md`/`GUIDE.md` (a palavra "legacy" só onde ainda descreve compatibilidade).
- [ ] Passo 1: o teste de `mcp-external-policy` (ou o que importa o nome) passa a importar `FLEET_CARD_WRITES`.
- [ ] Passo 2: rode. Esperado: FALHA porque o nome novo não existe.
- [ ] Passo 3: renomeie e atualize as docs.
- [ ] Passo 4: rode o teste citado. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(desktop): FLEET_CARD_WRITES no lugar de LEGACY_CARD_WRITES e docs das pastas que sobram (limpeza 8j)`

### Task 17: Limpezas 6, 7 e 9 — re-exports, dependências e testes
**Arquivos (Limpeza 6, ~23 shims de uma linha para `@sagyou/core`, a apagar depois de trocar os imports de todo o `src/` e de `apps/desktop/scripts/gen-sync-vectors.ts`, que importa dos shims `modules/sync/sync-*` e `modules/ai/memory`):** renderer `utils/{columns,financialRecord,dates,sync-view,money,dueDates,financialLegacy (já some na Task 10),habits,yieldSummary}.ts`, `store/normalization.ts`, `types/index.ts`, `components/financial/shared.ts`; main `modules/financial/money-text.ts`, `modules/sync/{sync-plan,hlc,sync-merge,sync-apply,sync-batch,sync-crypto,sync-records,sync-engine,sync-replace}.ts`, `modules/ai/memory.ts`. **Antes de apagar cada um**, confira que é só o re-export (por exemplo `types/index.ts` pode ter constantes locais) e procure `vi.mock` com o caminho antigo.
**Arquivos (Limpeza 7):** `apps/desktop/package.json` e `package-lock.json` sem `react-markdown` e `remark-gfm` (nenhum arquivo de `src/` os importa; se a task "Markdown nas descrições" for feita depois, ela os reinstala); `CLAUDE.md` sem a frase sobre `mergeEntities`/`mergeSprints`/`mergeHabits`/`mergeTombstones` (os símbolos não existem mais); tabelas do `CLAUDE.md`/`GUIDE.md` revisadas depois das tasks 1 a 16. A varredura de exports órfãos (knip ou ts-prune) roda **uma vez**, num workflow ou branch descartáveis, sem instalar nada no projeto; o resultado vira itens no board, não código neste PR.
**Arquivos (Limpeza 9, só o que é duplicado comprovado; nada de cobertura única):**
- `kanban.test.ts` `describe('shopping list actions')` (~663-752) repete `deleteList`, `toggleItem`, `updateItem` e `deleteItem` de `financial.test.ts`: ficam só `createList` (moeda padrão e informada), `updateList`, `setListCurrency` e `addItem`.
- `integration/store-flows.test.ts` "shopping list end-to-end flow" (~235) é subconjunto dos anteriores e calcula o total com um `reduce` dentro do próprio teste: sai. "bulk sprint creation" e "full kanban board workflow" ≈ `createSprints` e `createTask`/`moveTask` do `kanban.test.ts`: saem; se sobrar só `importAIJson`, mover para o teste do slice de backup e apagar o arquivo.
- `mcpActions.test.ts`: "before the store loads, nothing is written" (~133) e "refuses every write while the store is not loaded" (~1385) verificam a mesma recusa: unir num só (prepare e apply, `create_column` e `create_project`); "MCP handler coverage" (~1417) sai se o teste que compara a lista de ferramentas do main com a do renderer já cobre.
- `store-flows` "importBackup merge logic" e "habit merge during importBackup" (~126-232) têm nome de merge, mas `importBackup` substitui o estado: **não apague às cegas**; o CI mostra se passam. Renomeie para o que testam ou apague só se o outro teste cobre a mesma asserção.
- `kanban.test.ts` (1965 linhas): mover o trecho do slice de backup (~755-1430) para `store/backup.test.ts`, sem apagar asserção. Os trechos do chat legado e dos espelhos já saíram nas Tasks 5, 7, 8 e 10.
- Manter intactos os testes de dinheiro, sync, normalização e validação de backup.
**Interfaces:** os caminhos antigos deixam de existir; os testes de `packages/core` seguem como a especificação.
- [ ] Passo 1: antes de apagar cada teste duplicado, confirme por leitura que o outro cobre a mesma asserção e anote o par no corpo do commit.
- [ ] Passo 2: a troca de imports falha no typecheck do CI enquanto algum import apontar para um shim apagado. Esperado: FALHA até a troca estar completa.
- [ ] Passo 3: troque os imports com um script descartável (não commitado), apague os shims, remova as duas dependências, ajuste os testes.
- [ ] Passo 4: o CI roda typecheck, lint e a suíte. Esperado: PASSA.
- [ ] Passo 5: commits separados `refactor(desktop): troca os re-exports por @sagyou/core (limpeza 6)`, `chore(desktop): remove dependências sem uso (limpeza 7)` e `test(desktop): remove testes duplicados (limpeza 9)`

### Task 18: Fechamento
**Arquivos:** `apps/desktop/package.json`, `package-lock.json` (1.15.0), `CLAUDE.md`, `GUIDE.md`, `README.md`, `docs/data-migrations.md`.
- [ ] Passo 1: suba a versão do desktop para 1.15.0 e a do celular para 0.10.1 (`apps/mobile/app.json`, com o `versionCode` conforme `MAJOR×10000 + MINOR×100 + PATCH`, que o `app-config.test.ts` confere).
- [ ] Passo 2: leia o `CLAUDE.md`, o `GUIDE.md` e o `README.md` e confira que nenhum cita canal, módulo ou campo removido (`grep -rn` dos nomes da spec).
- [ ] Passo 3: rode a suíte inteira no CI. Esperado: PASSA, com o filtro do ESLint sem erro novo.
- [ ] Passo 4: verificação no app (`npm run dev`): abrir uma sessão do Fleet em um projeto e outra geral e conferir que o CLI sobe em branco com o MCP; abrir um projeto com timer rodando; importar um backup antigo.
- [ ] Passo 5: PR (estágio 5) com um commit por limpeza e a lista "lê / deixa de ler" da spec no corpo; fechar #71 e #72 como substituídos **só depois** de o dono aprovar.
