# Limpeza geral do código morto e dos formatos legados

Status: draft
<!-- Aprovada em 2026-11-27; voltou a draft porque a Emenda abaixo ampliou o escopo. Precisa de nova aprovação. -->
Branch: feature/limpeza-geral-legado

Tasks da sprint "Limpeza de código morto e formatos legados": Limpeza 1 a 9 (ids `b502623d`, `5eb9698e`, `03cd67b0`, `505f005d`, `23d28ed5`, `62e74164`, `48359ea5`, `d998cfa2`, `6b4235a4`). Esta spec **substitui** o rascunho da Limpeza 5 e reúne tudo em **um único PR**. Contexto histórico: `docs/specs/2026-10-24-remover-historico-chat.md`.

## Por quê
O app ainda carrega código que só serve a versões antigas, a uma migração que já rodou e a caminhos que nenhuma tela usa. Pesa na leitura, no contexto dos agentes e na reescrita em Rust. O dono confirmou (2026-11-27) que **todos os aparelhos, PCs e celulares, estão na última versão**.

## Objetivos
- Apagar o código morto (grupo A).
- Apagar os espelhos e as migrações de formato que só serviam a aparelhos antigos (grupo B).
- Deixar documentado, com teste, o que **fica** porque protege arquivos antigos e dados do usuário (grupo C).
- Entregar tudo num PR só, com uma lista "lê / deixa de ler" revisável item a item.

## Fora do escopo
- Mudar o schema SQLite além do que a Emenda diz: nenhuma coluna é apagada; a única tabela apagada é `entity_events`.
- Apagar arquivo do usuário no disco, em qualquer caso.
- O piso de versão de backup: **fica 1 a 7** (decisão do dono, 2026-11-27).
- Migrar para Rust.

## Decisões (de Luis)
1. Todos os aparelhos estão atualizados; espelhos e migrações para versões antigas podem sair.
2. Backup: continua aceitando as versões 1 a 7.
3. `legacyFinancialMetadata`: o dono nunca usou orçamentos nem recorrências e quer o campo **apagado por completo, inclusive do sync** (2026-11-27), aceitando alterar o contrato de sync pinado em `sync-vectors.json`.
4. As Limpezas 1 a 5 já têm código nos PRs #71 e #72; este PR as inclui (veja "Como montar o PR").

## Decisões do construtor (o agente decidiu; o humano pode mudar)
1. **Um PR, vários commits:** um commit por limpeza (1 a 9), para dar para revisar e reverter por partes. O título e o corpo listam as nove.
2. **Versão:** desktop 1.14.0 → **1.15.0 (MINOR)**, e não PATCH, porque tirar o espelho de escrita (`activeTimer`, `activeCodePathId`) é um caminho só de ida: uma versão antiga do app aberta sobre o banco novo não acharia timer nem pasta. Celular 0.10.0 → 0.10.1 (PATCH): o hash de sync roda no app e o `core` muda.
3. **A trava de escrita do `ai-config.json` fica** (as 14 chaves aposentadas nunca são gravadas). A task dizia para remover o corte das chaves, mas esse corte é o que impede `ai:config:set` de gravar uma chave de API no disco. Sai só a parte de migração (`stripAiConfigFile`, `hasLegacyApiConfig`).
4. **`entity_events`:** para de ser gravada (`diffEvents`, `appendEventRows`, `trimEventLog`). A tabela só é apagada pela Emenda (item 6), em commit próprio.
5. **Ordem dos commits:** limpezas independentes primeiro (1, 2, 4, 3), depois a 5, depois a 8, por fim 6, 7 e 9, para o diff da 6 (troca de imports) não esconder as outras.
6. **Teste de contrato:** o campo `activeCodePathId` aparece em `sync-vectors.json` só como dado de projeto de teste; o sync o trata como campo do aparelho (`DEVICE_PROJECT_FIELDS`), fora do hash. Um teste confirma que o hash e o `plan` de um projeto não mudam sem o campo singular. **Exceção autorizada pelo dono:** o `sync-vectors.json` é alterado só nos registros `financial_table` que traziam `legacyFinancialMetadata` (entradas, payloads e hashes dependentes, incluindo o lote selado se ele os contiver); o restante fica byte a byte igual e o diff é revisado linha a linha. Fixture regenerado com `apps/desktop/scripts/gen-sync-vectors.ts`, não editado à mão.

## Comportamento
Para quem usa, nada visível muda além de:
- O aviso dispensável do Fleet sobre o chat removido nunca mais aparece.
- O cabeçalho do terminal do Fleet perde a linha "nenhum arquivo indicado…".

O resto é interno: o que o app lê e grava.

## Dados

⚠️ Breaking schema change — existing data may be affected. Só para **versões antigas do Sagyou**: uma versão anterior à 1.15.0 aberta sobre um banco gravado pela nova deixa de achar o timer rodando e a pasta de código ativa. Nenhuma coluna ou tabela é removida. O único dado que deixa de ser guardado são `budgets` e `recurringTransactions` de backups antigos, recursos que o dono nunca usou (os bancos conferidos neste PC têm zero itens); o campo `legacyFinancialMetadata` é apagado **também do sync**: o hash dos registros `financial_table` que o traziam muda (nos bancos conferidos, só os de teste) e cada aparelho cria uma versão nova desses registros, uma única vez; o celular precisa receber o `core` novo.

### A. Código morto (sem dado persistido)
| Item | O que sai |
| --- | --- |
| Limpeza 1 | `ai:code:list/read/search`, `ai:project-file:read`, `ai:lineage:list` (handler, preload, testes); `code-files.ts` fica só com `confineToRoot`; `eventsForEntity` |
| Limpeza 2 | `ai:web:fetch`, `web-fetch.ts`, `web-render.ts` e testes (`external-links.ts` fica) |
| Limpeza 3 | `ai:skills:*`, `skills.ts`, migração de `ai-templates.json`, `agent-briefing.ts`, e os parâmetros `task`, `blank`, `files`, `readOnlyRoots`, `decisoes`, `coordinated` de `ai:code-agent:run`; `userData/skills/` fica no disco, sem ser lida |
| Limpeza 4 | `WebStorage` e o teste; `IStorageAdapter` fica como costura de teste |
| Limpeza 5 | migração do chat legado (`legacy-chat-removal.ts`, `legacy-chat-state.ts`, `handlers/legacy-chat.ts`, `legacy-ai-data.ts`), canais `legacy-chat:*`, aviso do Fleet, `convId` em `AgentRunMeta` e em `runsForSession`, `scrubMemoryConversationLinks` |
| Limpeza 6 | os ~23 re-exports de uma linha para `@sagyou/core`, trocados por imports diretos |
| Limpeza 7 | `react-markdown` e `remark-gfm` (se a task "Markdown nas descrições" não vier antes), a frase sobre `mergeEntities` no `CLAUDE.md`, e o resultado de uma varredura de exports órfãos feita **uma vez** no CI |
| Limpeza 9 | testes duplicados e o que a task lista; nada que seja cobertura única |
| `entity_events` | só a gravação (decisão 4) |
| `kanban-data.json` | `migrateFromJson` e `LEGACY_PATH` (importava o JSON do tempo sem SQLite) |
| `tsconfig.web.tsbuildinfo` | arquivo versionado, passa a ser ignorado |

### B. Formatos legados que os aparelhos atuais não usam (lê / deixa de ler)
| Item | Deixa de ler/gravar | Continua |
| --- | --- | --- |
| Espelho de timer | não grava mais `settings.activeTimer`; `loadData` não cai mais nele; `normalizeTimers` não aceita mais um timer singular | `activeTimers` (lista) |
| Espelho de pasta de código | `withActiveCodePaths` não grava mais `activeCodePathId`; a leitura singular de `rc-manager`, `agent-session-root`, `excelExport` e `store.ts` sai | `activeCodePathIds`; **a conversão do singular em lista continua em `normalizeProject`**, porque backups 1 a 7 podem trazer só o singular |
| Servidores RC | `legacyServerNames`, `migrateServerNames` e o aviso em `index.ts` | entradas por projeto |
| `mcp-external.json` | leitura de `expiresAt`, `projectId`, `financialProfileId`, `mode` | hash, `createdAt`, `lastUsedAt`, `allowWhileLocked` |
| Orçamentos e recorrências antigos (`legacyFinancialMetadata`) | **o campo inteiro:** `preserveLegacyFinancialMetadata`/`financialLegacy.ts`, a chamada em `normalizeFinancialTable`, o tipo, a escrita e a leitura em `store.ts`, o payload do record `financial_table` em `sync/records.ts`, o rótulo "Dados antigos" em `conflict-view.ts` e os testes do celular | nada: `budgets` e `recurringTransactions` de um backup antigo são descartados na importação |
| Conversões no banco | `migrateMoneyColumnsToText`, `migrateMemoryDropProjectFk`, `migrateTaskImagesToDisk` (só mexem em banco antigo) | os `ALTER TABLE … ADD COLUMN` ficam, porque criam colunas em instalação nova |

### C. O que fica (protege arquivos antigos ou dado do usuário)
Fica, e ganha um teste ou um comentário que diz por quê:
- Validador de backup 1 a 7, imagem inline `dataUrl`, tolerância a `conversations`/`chatImages` e a conversão de dinheiro `number` → texto no import (decisão do dono).
- `migrateYieldSummaryDates` e a conversão do singular `taskId` das notas: rodam também no import de backup antigo.
- O vínculo antigo transação→transação, e `isLegacyChild` no celular: é uma relação que existe nos dados, não só compatibilidade.
- `sourceConversationId` no core (sempre `null`) e a coluna `source_conversation_id`: o celular e o contrato de sync usam o tipo.
- Arquivos no disco: `userData/skills/`, `ai-templates.json`, `legacy-chat-state.json`, `backups/pre-remocao-chat-*` (nunca lidos nem apagados).

## Emenda (2026-11-27, pedido do Luis): adaptar o que fica e remover a sobra
Pedido: *"o que não pode ser apagado, adapte para funcionar com as novas features, e remova o que sobrar (lixo)"*. Leitura do construtor (o dono pode corrigir): o que **não** pode ser apagado, por vir de contrato de sync, de arquivo de backup ou de dado do usuário, deixa de se espalhar pelo código vivo e passa a morar **num só lugar**, descrito no modelo atual; todo campo, ramo ou tabela que, depois disso, ninguém lê nem escreve é apagado.

### Adaptar (fica, mas passa a funcionar com o modelo atual)
1. **Camada única de compatibilidade de backup** (`packages/core/src/backup-compat.ts`, função pura `upgradeLegacyBackup`): concentra o que hoje está espalhado nos normalizadores de carga: `activeCodePathId` singular → lista, `taskId` singular das notas → `taskIds`, `budgets`/`recurringTransactions` descartados, `conversations`/`chatImages` descartados, dinheiro `number` → texto, datas de resumo de rendimento de fim de mês, rastro textual de conversa e `sourceConversationId` nas memórias. **Só a importação de backup chama essa camada.** A carga do banco (`loadData`) e o sync passam a ver apenas o modelo atual, sem ramos de dado antigo.
2. **Nomes:** `LEGACY_CARD_WRITES` (regra atual dos cartões do Fleet) vira `FLEET_CARD_WRITES`. O que é compatibilidade fica só dentro de `backup-compat.ts` e é chamado assim.
3. **Documentação:** `docs/data-migrations.md` ganha a lista das pastas e arquivos que o Sagyou não lê mais e que o dono pode apagar à mão (`skills/`, `ai-templates.json`, `legacy-chat-state.json`, `backups/pre-remocao-chat-*`), com o aviso de que `backups/pre-remocao-chat-*` guarda as conversas antigas.

### Remover (a sobra)
4. **Campos sempre vazios das runs:** `decisions`, `readOnlyRoots` e `allowedWritePaths` em `CodeRunState`, `AgentRunMeta` (main, preload, renderer) e no parâmetro de `ai:code-agent:run`; o leitor de runs arquivadas ignora essas chaves em linhas antigas. Sem `allowedWritePaths`, `confineToRoot` fica sem chamador e `code-files.ts` e o teste saem. O parâmetro equivalente de `validatePatchScope` sai se não tiver outro uso.
5. **`sourceConversationId`:** sai do tipo `AiMemory` do core, de `memory.ts` e do `INSERT` do `store.ts`; a **coluna** SQLite fica (sem rebuild). Não está na lista de campos do hash de sync.
6. **Tabela `entity_events`:** ⚠️ `DROP TABLE IF EXISTS entity_events` (e o índice), idempotente, em commit próprio. Perde-se o diário de alterações, que nenhuma tela lê (até 50.000 linhas por banco). Não entra em backup nem em sync.

### O que continua igual
O que a spec já dizia que fica por contrato: arquivos do usuário no disco, `IStorageAdapter`, `confineToRoot` só enquanto tiver chamador, a trava das 14 chaves do `ai-config.json`, e o vínculo antigo transação→transação (relação que existe nos dados).

### Dados (emenda)
⚠️ Breaking schema change — existing data may be affected: (a) o diário `entity_events` é apagado; (b) a carga do banco deixa de converter dado antigo (dinheiro `number`, singular de pasta e de nota, datas de rendimento), que só a importação de backup converte. Todos os aparelhos já estão na última versão, então o banco atual já está no modelo novo.

## Telas
Só uma remoção: o aviso do Fleet sobre o chat removido. Sem tela nova nem texto novo.

## Como montar o PR
1. Base nova a partir de `origin/main` (1.14.0). Os PRs #71 e #72 estão desatualizados (o #71 em conflito) e o `main` mexeu em `agent-briefing.ts`, `terminal-handoff.ts` e `index.ts` ("handoff por sessão").
2. Reaplicar o conteúdo das Limpezas 1 a 4 sobre o `main` atual. Antes da Limpeza 3, **conferir que o briefing continua sem uso** depois do trabalho de handoff por sessão; se o Fleet passou a depender dele, a Limpeza 3 sai deste PR e vira pergunta.
3. Fechar #71 e #72 como substituídos, **só depois** de você aprovar este PR.
4. Sem `--no-verify`, sem force-push. Testes, typecheck e lint só no CI.

## Riscos e como se prova
- Um teste de ida e volta por item de B: carregar → salvar sem edição não muda timer nem pasta de código; o backup antigo (só singular) importa e vira lista.
- O `sync-vectors.json` só muda nos registros `financial_table` que traziam `legacyFinancialMetadata`; o diff do fixture é revisado linha a linha e o teste de vetores passa depois.
- O teste de canais removidos (`handlers.test.ts`) lista todos os canais que saem.
- Verificação no app (`npm run dev`): abrir uma sessão do Fleet (projeto e geral) e um projeto com timer rodando.

## Perguntas em aberto
Nenhuma.
