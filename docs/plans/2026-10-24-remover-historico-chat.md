# Plano de implementação: Remover o histórico de chat e a conexão por API

Status: approved by Luis on 2026-10-24
Spec: docs/specs/2026-10-24-remover-historico-chat.md
Branch: feature/remover-historico-chat

**Objetivo:** apagar com segurança o histórico de conversas, as chaves de API e os logs de custo na primeira abertura, e remover o chat genérico, deixando o Fleet como única porta de entrada.
**Arquitetura:** uma migração única e idempotente em `src/main/modules/ai/legacy-chat-removal.ts` (funções puras com E/S injetada) roda em `app.whenReady()` no lugar de `pruneConversations()`. Primeiro nasce a migração e o aviso (Tasks 1-3); depois o renderer deixa de usar o chat (Task 4); só então as camadas de dados e IPC que o renderer consumia são removidas (Tasks 5-9). Essa ordem mantém `typecheck` e `test` verdes ao fim de cada task.

## Restrições Globais

- Marca da migração: chave `legacyChatRemovedAt` na tabela `settings`, gravada só no fim. Ao iniciar, a migração apenas **confere** a marca.
- Ordem: conferir marca → snapshot → apagar conversas, imagens e `chat-files/` → apagar logs → limpar memória → reconstruir índice de busca → limpar `ai-config.json` → gravar marca. As chaves de API são o último passo destrutivo.
- Snapshot feito pelo main, sem renderer: pasta `userData/backups/pre-remocao-chat-<timestamp>/` com cópia de `ai-conversations.json`, `chat-images/`, `chat-files/` e do `kanban.db` (API `backup()` do better-sqlite3). `ai-config.json` **não** entra. Qualquer falha de cópia → nada é apagado e a marca não é gravada.
- Apaga: `ai-conversations.json`, `chat-images/`, `chat-files/`, `ai-usage-log.json`, `ai-run-metrics.json`.
- `ai-config.json` perde exatamente: `baseUrl`, `apiKey`, `model`, `providerProfiles`, `activeProviderProfileId`, `legacyProfileMigrated`, `chatProvider`, `modelComplex`, `maxSteps`, `inputPricePer1M`, `outputPricePer1M`, `timeoutMs`, `lastConversationId`, `codeAgent`. Preserva `codeHarness`, `userName`, `reasoningEffort`, flags de sandbox/ai-jail e toda chave desconhecida. Arquivo ilegível: não é tocado, aviso registrado.
- Importação de backup antigo ignora `conversations` e `chatImages` (o campo não entra em `pendingBlobs` nem vai ao disco); a versão do formato do backup não muda.
- Memórias ficam: `sourceConversationId` vira nulo, o trecho `(conversa completa: id=… — use ler_conversa…)` sai do corpo dos handoffs. A coluna `source_conversation_id` permanece no SQLite sem leitura nem escrita.
- Saem do MCP `search_conversations` e `read_conversation`; do renderer `buscar_conversas` e `ler_conversa`.
- Ficam por falta de mandato na spec (decisão do construtor): `ai:skills:*`, `ai:web:fetch`, `ai:code:*`, `ai:harnesses:status`, `modules/ai/evaluator.ts`, `ai:chatgpt:*` e os arquivos de sessão do ChatGPT. Os handlers `ai:chatgpt:*` e `ai:chat*` saem; os arquivos de sessão ficam.
- Sessão em branco continua sem briefing colado; o contexto chega só pelo MCP.
- `agent-runs/` fica. `AgentRunMeta` ganha `projectId: string | null` e `sessionId: string | null`; `convId` antigo é preservado na leitura. A poda por grupo passa a usar `sessionId ?? convId ?? '__none__'`.
- Aviso do Fleet: o main guarda `{ snapshotPath }` em memória até o renderer pedir (`legacy-chat:notice`, invoke) e dispensar (`legacy-chat:dismiss`, invoke, grava `legacyChatNoticeDismissedAt` em `settings`). Texto: "O histórico de conversas foi removido. Um backup foi salvo em <caminho>."
- Textos em pt-BR; código e comentários em inglês. Toda task termina com `npm run typecheck` e `npm test` verdes.

## Foco de Review

1. **Apagar antes de salvar o snapshot.** Esperado: snapshot falha → nenhum arquivo apagado, marca ausente. Testado na Task 1.
2. **`ai-config.json` ilegível sobrescrito ou chave desconhecida perdida.** Esperado: arquivo ilegível intocado; só as 14 chaves saem. Testado na Task 2.
3. **Migração repetida ou interrompida.** Esperado: com marca é no-op; sem marca, cada passo é idempotente e retoma. Testado na Task 1.
4. **Dados existentes afetados** (`kanban.db`, memórias, `agent-runs/`). Esperado: tasks, finanças e memórias intactas depois da migração; execuções antigas listáveis. Testado nas Tasks 3, 5 e 8.
5. **Backup antigo com `conversations`/`chatImages`/`sourceConversationId` falha ou ressuscita o chat.** Esperado: importa o resto e ignora esses campos, sem escrever em disco. Testado na Task 6.
6. **Aviso perdido ou repetido.** Esperado: aparece uma vez por migração concluída e some após dispensar. Testado nas Tasks 3 e 4.

### Task 1: Núcleo da migração com snapshot
**Arquivos:** Criar `src/main/modules/ai/legacy-chat-removal.ts`. Teste `src/main/__tests__/legacy-chat-removal.test.ts` (`@vitest-environment node`).
**Interfaces:** Produz `runLegacyChatRemoval(deps: LegacyChatRemovalDeps): Promise<LegacyChatRemovalResult>`, `deps = { userDataDir, getMarker(): string | null, setMarker(iso: string): void, copyDatabase(dest: string): Promise<void>, scrubMemories(): number, rebuildSearchIndex(): Promise<void>, stripAiConfig(): { warning?: string }, now(): Date }` e `Result = { status: 'done' | 'skipped' | 'aborted', snapshotDir?: string, warnings: string[] }`.
- [ ] Passo 1: testes que falham: (a) marca presente → `skipped`, nada chamado; (b) `copyDatabase` rejeita → `aborted`, `ai-conversations.json`, `chat-images/` e `chat-files/` ainda existem, marca ausente; (c) caminho feliz cria `backups/pre-remocao-chat-<ts>/` com os 3 itens copiados, apaga os 5 itens e grava a marca depois de `stripAiConfig`; (d) segunda chamada → `skipped`; (e) `scrubMemories` lança → marca ausente e nova chamada conclui; (f) arquivos ausentes não geram erro e o snapshot só copia o que existe; (g) `ai-config.json` nunca aparece no snapshot.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/legacy-chat-removal.test.ts`. Esperado: FALHA, módulo inexistente.
- [ ] Passo 3: implemente com cópia recursiva (`cpSync`) e `rmSync({ force, recursive })` por item, na ordem das Restrições Globais.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(ai): núcleo da migração que remove o histórico de chat`.

### Task 2: Limpeza do ai-config.json
**Arquivos:** Modificar `src/main/modules/ai/legacy-chat-removal.ts`. Mesmo arquivo de teste.
**Interfaces:** Produz `stripLegacyApiConfig(value: unknown): { config: Record<string, unknown>, changed: boolean }` e `stripAiConfigFile(path: string): { warning?: string }`.
- [ ] Passo 1: testes que falham: (a) remove exatamente as 14 chaves; (b) preserva `codeHarness: 'claude-code'`, `userName`, `reasoningEffort` e `futureSetting: { keep: true }`; (c) valor não-objeto → `changed: false`; (d) arquivo com JSON inválido não é reescrito e devolve `warning`; (e) escrita via `.tmp` + rename; (f) arquivo ausente não gera erro.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/legacy-chat-removal.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente as duas funções.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(ai): remove chaves de API do ai-config na migração`.

### Task 3: Ligar a migração ao app e ao aviso
**Arquivos:** Modificar `src/main/index.ts` (substitui `pruneConversations()` no `whenReady`, antes de `createWindow()`; registra `legacy-chat:notice` e `legacy-chat:dismiss`), `src/main/store.ts` (`getSetting`/`setSetting` públicos e `clearConversationLinks()`), `src/main/modules/ai/memory.ts` (`scrubConversationLinks`), `src/preload/index.ts`. Testes `src/main/__tests__/legacy-chat-removal.test.ts`, `memory.test.ts`, `handlers.test.ts`.
**Interfaces:** Consome `runLegacyChatRemoval`. Produz `scrubConversationLinks(memories: AiMemory[]): { memories: AiMemory[], changed: number }`, `window.electronAPI.legacyChat = { notice(): Promise<{ snapshotDir: string } | null>, dismiss(): Promise<void> }`.
- [ ] Passo 1: testes que falham: (a) `scrubConversationLinks` remove o trecho `(conversa completa: id=…` do corpo e zera `sourceConversationId` em ativas e arquivadas, sem mexer em outros campos; (b) com SQLite real em diretório temporário, a migração deixa `tasks`, `projects` e `memory` (exceto os vínculos) idênticos; (c) `legacy-chat:notice` devolve o caminho depois de `done`, `null` depois de `dismiss` e `null` quando a migração foi `skipped`; (d) a migração roda antes de `createWindow()`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/legacy-chat-removal.test.ts src/main/__tests__/memory.test.ts src/main/__tests__/handlers.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente as dependências reais (`copyDatabase` via `db.backup()`; `rebuildSearchIndex` existente; `stripAiConfig` via `stripAiConfigFile`).
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(ai): executa a migração na abertura e expõe o aviso`.

### Task 4: Remover a tela de Chat e o loop do assistente
**Arquivos:** Excluir `src/renderer/src/components/ai/AIView.tsx`, `AiRunHost.tsx`, `ConversationHistoryMenu.tsx`, `ChatMessageParts.tsx`, `ChatMarkdown.tsx`, `ChatSettingsPanel.tsx`, `SpendPanel.tsx`, `SwitchAI.tsx`, `ConnectionGuide.tsx`, `src/renderer/src/store/aiRun.ts`, `src/renderer/src/ai/agent.ts`, `tools.ts`, `tools/`, `tool-contracts.ts`, `permission-registry.ts`, `validators.ts`, `system-prompt.md`, `src/renderer/src/utils/aiDisplay.ts`. Modificar `src/renderer/src/App.tsx`, `components/layout/Sidebar.tsx`, `FleetView.tsx`, `fleet/Workspaces.tsx`, `fleet/format.ts`, `fleet/SessionRail.tsx`, `components/ai/AgentRunPicker.tsx`, `CodeAgentLauncher.tsx`, `components/ai/MemoryView.tsx`, `components/views/HomeView.tsx`, `types/index.ts`, `src/renderer/src/store/slices/backup.ts` (sem leitura de conversas no export). Testes: remover `AIView.test.tsx`, `AiRunHost.test.tsx`, `store/aiRun.test.ts`, `ai/agent.test.ts`, `ai/tools.test.ts`; atualizar `FleetView.test.tsx`, `SearchModal.test.tsx`, testes de `HomeView`.
**Interfaces:** `FleetView({ projects, retainThread })` sem `onOpenChat`; `SessionItem.kind` só `'run'`; Sidebar mantém `agents` e `memory` e perde `ai`; o Fleet chama `window.electronAPI.legacyChat.notice()` ao montar e `dismiss()` ao fechar o aviso. Os canais IPC do main continuam existindo nesta task (saem na Task 9).
- [ ] Passo 1: testes que falham: (a) Sidebar sem item "Chat"; (b) `FleetView` lista só sessões de terminal e abre "Nova sessão" em branco; (c) `App` não renderiza `AIView`; (d) `MemoryView` e `HomeView` renderizam sem `aiRun`; (e) aviso "O histórico de conversas foi removido. Um backup foi salvo em <caminho>." aparece quando `notice()` devolve caminho e some após `dismiss()`.
- [ ] Passo 2: rode `npx vitest run src/renderer/src/__tests__/components`. Esperado: FALHA.
- [ ] Passo 3: implemente; o handoff automático de `aiRun.ts` (`writeHandoff`) some junto com o loop.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(ui): remove a tela de Chat e o loop do assistente`.

### Task 5: Memória sem vínculo de conversa
**Arquivos:** Modificar `src/main/modules/ai/memory.ts`, `src/main/handlers/memory.ts`, `src/main/modules/agent/terminal-handoff.ts`, `src/main/store.ts`, `src/renderer/src/types/index.ts`. Testes `memory.test.ts`, `terminal-handoff.test.ts`, `handlers.test.ts`.
- [ ] Passo 1: testes que falham: (a) `buildMemory` ignora `sourceConversationId` na entrada e não o grava; (b) `ai:memory:handoff` não aceita nem persiste o campo; (c) handoff de terminal não inclui `conversa=` nas referências; (d) linha antiga com `source_conversation_id` preenchido é lida sem erro e devolve `null`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/memory.test.ts src/main/__tests__/terminal-handoff.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente; `AiMemory.sourceConversationId` vira opcional e sempre `null` na leitura.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(memory): desacopla a memória das conversas`.

### Task 6: Backup ignora conversas e imagens de chat
**Arquivos:** Modificar `src/main/modules/files/backup-validation.ts`, `src/main/handlers/backup.ts` (sai `collectChatImages`, `restoreChatImages`, `chatImagesDir` e `chatImages` do `pendingBlobs`), `src/renderer/src/store/slices/backup.ts`, `src/renderer/src/services/StorageAdapter.ts`, `ElectronStorage.ts`, `WebStorage.ts`, `src/renderer/src/types/index.ts`. Testes `src/main/__tests__/backup-validation.test.ts`, `backup-files.test.ts`, `src/renderer/src/__tests__/store/backup.test.ts`.
**Interfaces:** `IStorageAdapter` perde `loadConversations`/`saveConversations`; `Backup` aceita `conversations` e `chatImages` como campos opcionais ignorados.
- [ ] Passo 1: testes que falham: (a) `isValidBackup` aceita backup v5 com `conversations` e `chatImages` (inclusive com id inválido, que é ignorado); (b) importar esse backup restaura tasks e memórias, não chama armazenamento de conversas e não cria nada em `chat-images/`; (c) `exportBackup` não contém `conversations` nem `chatImages`; (d) memórias importadas com `sourceConversationId` chegam sem o campo; (e) o export normal ainda inclui `fileBlobs` e `taskImages`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/backup-validation.test.ts src/renderer/src/__tests__/store/backup.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(backup): ignora conversas e imagens de chat`.

### Task 7: Índice de busca sem conversas
**Arquivos:** Modificar `src/main/modules/search/global-search-index.ts`, `global-search-query.ts`, `src/renderer/src/components/modals/SearchModal.tsx`, `src/renderer/src/App.tsx`. Testes `global-search-index.test.ts`, `global-search-query.test.ts`, `SearchModal.test.tsx`.
- [ ] Passo 1: testes que falham: (a) `buildSearchDocuments` não gera `conversation`; (b) o sync usa `"type NOT IN ('memory')"`; (c) linhas `conversation` já no `global_search_fts` somem após `rebuildSearchIndex`; (d) `SearchModal` não oferece o filtro "Conversa"; (e) `search:global` com `types: ['conversation']` devolve vazio sem erro.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/global-search-index.test.ts src/renderer/src/__tests__/components/SearchModal.test.tsx`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(search): remove conversas do índice global`.

### Task 8: Execuções ligadas a projeto e sessão
**Arquivos:** Modificar `src/main/modules/agent/agent-runs.ts`, `src/main/index.ts` (blocos de `convId`; `ai:code-agent:run`, `ai:code-agent:runs`; remove `briefCurrentConversation` e `relatedConversations` do briefing), `src/main/modules/agent/agent-briefing.ts`, `src/preload/index.ts`, `src/renderer/src/components/ai/fleet/useCodeAgentRuns.ts`, `FleetView.tsx`, `CodeAgentLauncher.tsx`. Testes `agent-runs.test.ts`, `agent-briefing.test.ts`, `FleetView.test.tsx`.
**Interfaces:** `AgentRunMeta` ganha `projectId: string | null` e `sessionId: string | null`; `ai:code-agent:run` recebe `sessionId?: string` no lugar de `convId`; `runsForConv` é substituído por `runsForSession(runs, sessionId)`. O `sessionId` é um uuid gerado pelo Fleet ao abrir a sessão.
- [ ] Passo 1: testes que falham: (a) execução antiga só com `convId` continua listada e o `convId` é preservado no `index.json`; (b) `runsForSession` filtra por `sessionId`; (c) nova sessão grava `sessionId` e `projectId` (nulo para sessão geral); (d) a poda agrupa por `sessionId ?? convId ?? '__none__'`; (e) o briefing não contém mais seções de conversa; (f) o Fleet abre uma sessão em branco enviando `sessionId` e sem `convId`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/agent-runs.test.ts src/main/__tests__/agent-briefing.test.ts src/renderer/src/__tests__/components/FleetView.test.tsx`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(agent): liga execuções a projeto e sessão`.

### Task 9: Remover IPC, MCP e módulos do chat
**Arquivos:** Modificar `src/main/index.ts`, `src/main/modules/agent/sagyou-mcp.ts`, `src/preload/index.ts`, `src/main/handlers/files.ts` (sai `chat-files`), `src/main/handlers/backup.ts`. Excluir `src/main/handlers/conversations.ts`, `src/main/modules/conversations/` (exceto `legacy-ai-data.ts`, que perde `normalizeLegacyConversations` e fica com `normalizeLegacyAIConfig`), `modules/ai/usage.ts`, `modules/ai/run-metrics.ts`, `modules/ai/openai-client.ts` (se sem uso). Testes: atualizar `sagyou-mcp.test.ts`, `handlers.test.ts`, `legacy-ai-data.test.ts`; remover `conversation-retention.test.ts`, `conversation-search.test.ts`, `chat-images.test.ts`, `chat-files.test.ts`, `usage.test.ts`, `run-metrics.test.ts`, `openai-client.test.ts`.
**Interfaces:** Saem `registerConversationHandlers`, `ai:conversations:*`, `ai:images:*`, `ai:usage:summary`, `ai:run-metrics:*`, `ai:chat*`, `ai:models`, `ai:chatgpt:*`; `ai:config:get/set` ficam só com campos de agente.
- [ ] Passo 1: testes que falham: (a) `tools/list` do MCP não tem `search_conversations` nem `read_conversation`; (b) `handlers.test.ts` afirma que cada canal removido **não** está registrado; (c) `ai:config:set` não aceita nem devolve chaves de API; (d) `normalizeLegacyAIConfig` continua preservando chaves desconhecidas e convertendo `sagyou` em `codex`.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/sagyou-mcp.test.ts src/main/__tests__/handlers.test.ts src/main/__tests__/legacy-ai-data.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente; remova o que ficou sem referência e confira com `npm run typecheck`.
- [ ] Passo 4: rode `npm run typecheck && npm test`. Esperado: PASSA.
- [ ] Passo 5: commit `refactor(ai): remove IPC, MCP e módulos do chat genérico`.

### Task 10: Suíte completa, app e documentação
**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md` (inclui as regras sobre conversa citada por memória e retenção de conversas, que passam a ser falsas), `README.md`, `AGENTS.md`, `docs/data-migrations.md`, `docs/harness-chat-architecture.md`.
- [ ] Passo 1: rode `npm run typecheck && npm run lint && npm test && npm run test:coverage`. Esperado: verde; lint sem erro novo.
- [ ] Passo 2: verificação no app com `npm run dev` sobre uma **cópia** de dados reais: a primeira abertura cria a pasta de snapshot, apaga os 5 itens, limpa o config e mostra o aviso; a segunda abertura não repete; um backup antigo importa sem trazer o chat; uma sessão do Codex em branco abre e o MCP responde.
- [ ] Passo 3: atualize `CLAUDE.md`, `GUIDE.md` e `README.md` (chat, IPC, tabela de `userData`, memória, backup, retenção) e reescreva `docs/data-migrations.md` descrevendo a migração, o snapshot em pasta e a perda definitiva das chaves.
- [ ] Passo 4: abra o PR pela skill `sagyou-pr` (estágio 5).
- [ ] Passo 5: commit `docs(remover-historico-chat): atualiza CLAUDE, GUIDE, README e migrações`.
