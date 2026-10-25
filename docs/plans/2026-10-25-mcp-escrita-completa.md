# Plano de implementação: MCP com escrita completa

Status: approved by Luis on 2026-10-25
Spec: docs/specs/2026-10-25-mcp-escrita-completa.md
Branch: feature/mcp-escrita-completa

**Objetivo:** o `sagyou-mcp` ganha 34 ferramentas de escrita (projetos, colunas, tarefas, metas, notas, finanças no perfil da sessão, memórias), e só as arriscadas pedem cartão.

**Arquitetura:** o main define as ferramentas (schema), a classificação de cartão por nome e as operações de memória, e não importa nada do renderer (`tsconfig.node.json` não inclui `src/renderer`). A validação dos dados do app mora no renderer, contra o store vivo, em duas fases pelo canal novo `store:mcp:action`:
1. `prepare` valida e devolve o resumo do cartão, sem escrever.
2. `apply` revalida, chama a ação existente do slice e faz `_flushPersist()`.

As duas fases rodam **dentro** da `McpWriteQueue`, serializada por run. Assim cada chamada é validada só depois de a anterior estar aplicada e salva. `criar_task` e `save_memory` ficam como estão.

## Restrições Globais

- Sem mudança de dados: nenhum campo, tabela, migração ou formato de backup novo. As duas ações novas de slice (Task 2) só combinam campos que já existem.
- `src/main` nunca importa de `src/renderer`. Tipos do canal ficam em dois espelhos: `src/main/modules/agent/mcp-write-types.ts` e `src/renderer/src/types/mcp-actions.ts`. Um teste de main compara a lista de nomes entre os dois arquivos, lendo o texto do arquivo do renderer, sem importar. Constantes de domínio (`PROJECT_COLORS`, `NOTE_COLORS`, `CURRENCY_CONFIG`, `isDoneColumn`) são usadas só no renderer. (decisão do construtor)
- Nomes das ferramentas em inglês `snake_case`, argumentos em inglês camelCase (`id`, `projectId`, `title`, `description`, `dueDate`, `priority`, `tags`, `column`). (decisão do construtor: a spec escrevia `coluna`)
- **Pedem cartão** (`MCP_APPROVAL_REQUIRED`, em `mcp-write-tools.ts`, decidido só pelo nome): `archive_project`, `delete_project`, `delete_column`, `delete_task`, `delete_goal`, `delete_note`, `create_transaction`, `update_transaction`, `delete_transaction`, `create_financial_table`, `remove_financial_category`, `create_financial_profile`, `rename_financial_profile`, `delete_memory`. As outras 20 estão em `MCP_NO_APPROVAL`.
- Canais de resposta: sessão inválida, ferramenta fora das permissões ou nome desconhecido → `failure()` JSON-RPC `"Ferramenta indisponível nesta sessão MCP."` (como hoje). Qualquer recusa de domínio (validação, ambiguidade, cartão negado, run encerrada) → `reply` com `{ ok: false, error, candidatos? }` (como `save_memory`).
- Cartão negado: `{ ok: false, error: "<Ação> não aprovada pelo usuário." }`, com `<Ação>` de `MCP_DENIAL_LABEL` (`Exclusão`, `Arquivamento`, `Lançamento`, `Edição`, `Criação`).
- Run encerrada ou abortada: a fila checa `isRunLive(runId)` (mesma condição que `requestMcpWriteApproval` usa hoje: run existe, não abortada e não `interactive && !externalChild`) antes de `prepare` e antes de `apply`, inclusive em escritas sem cartão → `{ ok: false, error: "A execução MCP foi encerrada." }`.
- Sucesso: `{ ok: true, id, ...campos essenciais }`, nunca o registro inteiro.
- Escopo: `projectId` omitido → `session.projectId`; sessão geral sem `projectId` → `"Escolha um projeto em list_projects."`. O renderer recebe `{ projectId, financialProfileId }` da sessão em cada `prepare`/`apply`.
- Ambiguidade: busca por título com mais de um resultado → `{ ok: false, error: "Mais de um registro com esse título; use o id.", candidatos: [{ id, title }] }` (máx. 10).
- Limites (após `trim()`; excedente → erro, nunca corte silencioso):
  - título de tarefa/meta 300; descrição 5000; nome de projeto 120; nome de coluna 60; conteúdo de nota 5000;
  - tags ≤ 20, cada ≤ 60; categoria 60; nome de tabela/perfil 80; descrição de transação 300; rótulo de progresso 200;
  - links ≤ 20, `label ≤ 80`, `url` http(s) ≤ 2000, sem credenciais (lidas de `url.username`/`url.password`).
- Datas `YYYY-MM-DD` de calendário real (`2026-02-30` recusado); data omitida → `todayLocalISO()`.
- Prioridade ∈ `low|medium|high|urgent`; cor de projeto/meta ∈ `PROJECT_COLORS`; cor de nota ∈ `NOTE_COLORS`; moeda ∈ `BRL|USD|JPY`; tipo de transação ∈ `receita|despesa` (→ `income|expense`).
- Dinheiro: `parseMcpMoney(raw)` (renderer, `services/mcpActions.ts`) aceita número positivo ou string `^\d+([.,]\d{1,2})?$`; recusa separador de milhar, sinal e zero; guarda `new Decimal(x).toDecimalPlaces(2).toString()`.
- Meta: `target` finito > 0; sem `color` → `PROJECT_COLORS[0]` (igual ao `GoalModal`); sem `kind` → `quantity`; `kind: 'completion'` força `target = 1`.
- Nota nova: primeira célula livre numa grade de passo 220×170 a partir de (100,100), 5 por linha, sem sobrepor notas do projeto (200×150).
- Perfil financeiro: tudo restrito a `session.financialProfileId`. Tabela/transação de outro perfil ou inexistente → `"Tabela indisponível nesta sessão MCP."` / `"Transação indisponível nesta sessão MCP."`.
- Transação com `debtId` → `"Esta transação pertence a uma dívida; altere-a no Sagyou."` na edição e na exclusão.
- Memória `handoff` em `update_memory`/`resolve_memory_conflict` → `"Memórias de handoff não podem ser alteradas pelo MCP."`. Memória arquivada ou inexistente em edição → `"Memória indisponível nesta sessão MCP."`.
- `activeProjectId` nunca muda por causa do MCP: `applyMcpAction` restaura o valor anterior depois de `createProject` e `archiveProject`. Se o projeto ativo for o arquivado ou excluído, vale o fallback do próprio slice. (decisão do construtor: um agente em segundo plano não troca a tela do usuário)

## Decisões do construtor tomadas no plano (corrigem ou detalham a spec)

1. **`delete_project` faz exatamente o que o botão do app faz**: remove o projeto e suas tarefas (com tombstones). Notas e metas do projeto **ficam**, como hoje. O cartão diz `Excluir projeto "<nome>" e N tarefa(s)`. A spec dizia que as notas iam junto, o que não é o que o botão faz; a frase da spec é corrigida para "projeto e tarefas, como o botão".
2. **Perfis financeiros**: `rename_financial_profile` renomeia **só o perfil da sessão** e não recebe `id`. `create_financial_profile` cria o perfil, mas a sessão continua escrevendo só no perfil capturado (o novo fica para a próxima sessão ou para o app).
3. **Coluna "Done"**: concluída é decidido pelo nome (`isDoneColumn`). O MCP recusa renomear a coluna Done e recusa dar o nome "done" (sem diferenciar maiúsculas) a outra coluna: `"A coluna de concluídas é identificada pelo nome \"Done\"; renomeie-a no Sagyou."`. Excluir a coluna Done segue a regra de excluir qualquer coluna (só vazia).
4. **Links de projeto**: `links` substitui a lista inteira; `[]` limpa. Um link cuja `url` já existe mantém seu `id`; um novo recebe `uuidv4()`.
5. **Categorias**: `add_financial_category` ignora caixa (como o slice). `remove_financial_category` encontra sem diferenciar maiúsculas e remove a grafia guardada.
6. **Perfil com nome duplicado**: deduplicado no `prepare` (sem diferenciar maiúsculas) → `{ ok: true, id: <existente>, existente: true }` sem cartão.

## Foco de Review

1. **Ação arriscada sem cartão.** Teste exaustivo: cada ferramenta de `MCP_WRITE_TOOLS` está em exatamente um dos dois conjuntos, e o conjunto com cartão é igual à lista acima. Testado na Task 3.
2. **Validação contra estado velho ou fora de ordem.** `prepare` roda dentro da fila depois do flush da escrita anterior, e `apply` revalida tudo. São três casos: tarefa excluída no app entre `prepare` e `apply` → `"Tarefa não encontrada."`; tarefa criada numa coluna entre `prepare` e `apply` de `delete_column` → recusa, nada é apagado; `create_column` seguido de `move_task` para ela na mesma run → funciona. Testado nas Tasks 3 e 4.
3. **Vazamento entre perfis financeiros.** `tableId` e `id` de transação de outro perfil recebem a mesma resposta que um id inexistente, e nada muda. `rename_financial_profile` só alcança o perfil da sessão. Testado na Task 6.
4. **Dados existentes intactos.**
   - editar transação passa por `updateTransaction` → `applyFinancialTransactionEdit` (auditoria; `reconciledAt` limpo ao mudar valor/data/tipo);
   - valores continuam decimal string;
   - excluir tarefa gera tombstone;
   - excluir projeto não apaga notas nem metas;
   - remover categoria não reescreve transações.

   Testado nas Tasks 3, 4 e 6.
5. **Mover tarefa entre projetos.** Coluna resolvida no destino, sprint limpa, cronômetro **sempre** parado e creditado (não só ao concluir), conclusão/reabertura conforme a coluna destino. Testado nas Tasks 2 e 4.

### Task 1: Fila com preparação, cartão opcional e checagem de run viva

**Arquivos:** Modificar `src/main/modules/agent/mcp-write-queue.ts`. Teste `src/main/__tests__/mcp-write-queue.test.ts`.
**Interfaces:** Produz:
- `McpWriteRequest { runId: string; name: string; args: Record<string, unknown>; approval?: boolean; resumo?: string }`, com `approval` ausente = `true`;
- `constructor(approve, isRunLive: (runId: string) => boolean = () => true)`;
- `enqueue<T>(request, execute, prepare?: () => Promise<{ resumo: string } | { refuse: T }>)`, que resolve `McpWriteOutcome<T> = { approved: boolean; value?: T; refused?: boolean; ended?: boolean }`.

A ordem dentro do `drain` é:
1. `isRunLive`, senão `ended`;
2. `prepare` (pode recusar com `refused` + `value`);
3. cartão, se `approval !== false`, usando o `resumo` do `prepare`;
4. `isRunLive` de novo;
5. `execute`.

- [ ] Passo 1: testes:
  - `skips the approval callback when approval is false`;
  - `runs prepare inside the queue after the previous write finished` (a segunda `prepare` vê o efeito da primeira `execute`);
  - `a refusing prepare never reaches approval or execute`;
  - `prepare resumo is what the approval callback receives`;
  - `a run that ended before execute does not execute, even without approval`;
  - `rejectRun cancels queued no-approval writes`;
  - os testes atuais continuam passando sem mudança.
- [ ] Passo 2: `npx vitest run src/main/__tests__/mcp-write-queue.test.ts`. Esperado: FALHA porque `approve` é sempre chamado e não há `prepare`/`isRunLive`.
- [ ] Passo 3: implemente.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): fila MCP com preparação, cartão opcional e checagem de run viva`

### Task 2: Ações de slice que faltam

**Arquivos:** Modificar `src/renderer/src/store/slices/tasks.ts`, `src/renderer/src/store/slices/financial.ts`. Teste `src/renderer/src/__tests__/store/kanban.test.ts`, `src/renderer/src/__tests__/store/financial.test.ts`.
**Interfaces:** Produz `moveTaskToProject(taskId: string, projectId: string, columnId: string): boolean` e `renameFinancialProfile(id: string, name: string): boolean`.
- [ ] Passo 1: testes:
  - `moveTaskToProject moves into the target column, clears sprint and appends at the end`;
  - `moveTaskToProject always stops and credits a running timer, even into a non-done column`;
  - `moveTaskToProject completes when the target column is done and reopens when it is not`;
  - `moveTaskToProject refuses a column of another project`: retorna `false` e nada muda;
  - `renameFinancialProfile trims, persists and bumps updatedAt`; retorna `false` com nome vazio ou id inexistente; `personal` pode ser renomeado.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/store/kanban.test.ts src/renderer/src/__tests__/store/financial.test.ts`. Esperado: FALHA porque as ações não existem.
- [ ] Passo 3: `moveTaskToProject` primeiro chama `stopTimer(taskId)` se houver timer, depois aplica `projectId`, `columnId`, `sprintId: undefined` e `order` no fim. Por fim aplica `completedAt` conforme `isDoneColumn` da coluna destino, com a mesma regra de entrada/saída do `moveTask`. `_persist()`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(store): adiciona moveTaskToProject e renameFinancialProfile`

### Task 3: Infra das escritas + projetos e colunas

**Arquivos:**
- Criar `src/main/modules/agent/mcp-write-tools.ts`, `src/main/modules/agent/mcp-write-types.ts`, `src/renderer/src/types/mcp-actions.ts`, `src/renderer/src/services/mcpActions.ts`.
- Modificar `src/main/modules/agent/sagyou-mcp.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`.
- Teste: criar `src/main/__tests__/mcp-write-tools.test.ts` e `src/renderer/src/__tests__/services/mcpActions.test.ts`; modificar `src/main/__tests__/sagyou-mcp.test.ts`.

**Interfaces:**
- Consome a fila da Task 1.
- Tipos (espelhados nos dois arquivos):
  - `McpScope { projectId: string | null; financialProfileId: string }`;
  - `McpActionRequest = { phase: 'prepare' | 'apply'; name: string; args: Record<string, unknown>; scope: McpScope }`;
  - `McpActionResult = { ok: true; id: string; resumo?: string; [k: string]: unknown } | { ok: false; error: string; candidatos?: { id: string; title: string }[] }`.
- `mcp-write-tools.ts` (puro, sem Electron, sem renderer):
  - `MCP_WRITE_TOOLS: McpToolDefinition[]`, schemas com enums literais só para prioridade, moeda, tipo de transação, `kind` e tipo de memória;
  - `MCP_APPROVAL_REQUIRED`, `MCP_NO_APPROVAL: ReadonlySet<string>`;
  - `MCP_DENIAL_LABEL: Record<string, string>`;
  - `MCP_MEMORY_TOOLS: ReadonlySet<string>`.
- Renderer, `services/mcpActions.ts`:
  - `prepareMcpAction(name, args, scope): McpActionResult`, em que `ok: true` traz `resumo` e não escreve;
  - `applyMcpAction(name, args, scope): McpActionResult`;
  - ambos via `useKanbanStore.getState()`, compartilhando um validador por ferramenta para `apply` revalidar exatamente o que `prepare` checou.
- Broker: `McpBrokerDeps.write(session, name, args): Promise<McpActionResult>`. Os nomes de `MCP_WRITE_TOOLS` entram em `MCP_PERMISSIONS` (logo em `CODE_EXECUTOR_MCP_PERMISSIONS`) e em `TOOLS`. `write` só é chamado para nomes em `MCP_WRITE_TOOLS` e permitidos.
- IPC: main → renderer `store:mcp:action` `{ requestId, request: McpActionRequest }`; renderer → main `store:mcp:action:response` `{ requestId, result: McpActionResult }`. Preload expõe `onMcpAction(cb)` e `respondMcpAction(requestId, result)`. Em main, `rendererMcpActions = new RendererMcpActionBridge<McpActionRequest, McpActionResult>`, fechada junto de `rendererMcpTasks.close()` no teardown.
- `index.ts` `write`, para ferramentas do renderer: `mcpWriteQueue.enqueue({ runId, name, args, approval: MCP_APPROVAL_REQUIRED.has(name) }, () => bridge.request({ phase: 'apply', … }), () => bridge.request({ phase: 'prepare', … }).then(r => r.ok ? { resumo: r.resumo! } : { refuse: r }))`. Mapeia `refused` → o `value`, `ended` → erro de run encerrada e `approved:false` → recusa de cartão. `requestMcpWriteApproval` usa `request.resumo` quando presente; o ramo de `criar_task` fica igual. A fila é construída com `isRunLive` extraído da condição atual de `requestMcpWriteApproval`.
- `App.tsx`: o listener chama `prepareMcpAction` ou `applyMcpAction` conforme a fase. Depois de `apply` com `ok`, faz `await _flushPersist()` e responde.

Ferramentas desta task:
- `create_project`: `name`, `description?`, `color?`. Nome duplicado (aparado, sem diferenciar maiúsculas) → `{ ok: true, id: <existente>, existente: true }`. Restaura `activeProjectId`.
- `update_project`: `projectId`, `name?`, `description?`, `color?`, `links?` (decisão 4).
- `archive_project` (cartão).
- `unarchive_project`.
- `delete_project` (cartão, decisão 1).
- `create_column`: `projectId?`, `name`, `color?`.
- `update_column`: `projectId?`, `column` (id ou nome), `name?`, `color?` (decisão 3).
- `reorder_columns`: `projectId?`, `columnIds`, que precisa ser permutação exata, senão `"columnIds precisa listar todas as colunas do projeto, uma vez cada."`.
- `delete_column` (cartão). Com tarefas → `A coluna "<nome>" tem N tarefa(s); mova-as antes de excluí-la.`; última coluna → `"O projeto precisa de pelo menos uma coluna."`.

- [ ] Passo 1: testes que falham:
  - `mcp-write-tools.test.ts`:
    - `every write tool is classified exactly once`, e o conjunto com cartão é igual à lista das Restrições Globais;
    - `renderer mirror lists the same tool names` (lê `src/renderer/src/types/mcp-actions.ts` como texto);
    - `MCP_DENIAL_LABEL covers every approval tool`.
  - `mcpActions.test.ts`:
    - cada ferramenta de projeto/coluna altera o store como o slice faria;
    - `create_project keeps activeProjectId`;
    - `duplicate project name returns the existing id`;
    - `delete_project keeps notes and goals and resumo counts tasks`;
    - `delete_column refused in apply when a task appeared after prepare` (nenhuma tarefa apagada);
    - `renaming Done or naming a column done is refused`;
    - `links replace keeps ids of unchanged urls and refuses credentials`;
    - `general scope without projectId asks for one`.
  - `sagyou-mcp.test.ts`:
    - `routes permitted write tools to deps.write`;
    - `write tools are listed only when permitted`;
    - `unknown write name fails as unavailable`;
    - `a domain refusal is a reply with ok:false, not a JSON-RPC error`.
- [ ] Passo 2: `npx vitest run src/main/__tests__/mcp-write-tools.test.ts src/main/__tests__/sagyou-mcp.test.ts src/renderer/src/__tests__/services/mcpActions.test.ts`. Esperado: FALHA porque os módulos não existem.
- [ ] Passo 3: implemente.
- [ ] Passo 4: mesmo comando + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): escrita de projetos e colunas pelo MCP`

### Task 4: Tarefas

**Arquivos:** Modificar `src/main/modules/agent/mcp-write-tools.ts`, os dois espelhos de tipos e `src/renderer/src/services/mcpActions.ts`. Teste: `mcp-write-tools.test.ts` e `mcpActions.test.ts`.
**Interfaces:** Consome a infra da Task 3 e `moveTaskToProject` (Task 2).

Ferramentas: todas aceitam `id` ou `title` (busca exata aparada, sem diferenciar maiúsculas, no projeto do escopo).
- `update_task`: `title?`, `description?`, `dueDate?`, `priority?`, `tags?`. Só os campos enviados; `""` limpa `description`/`dueDate`; `[]` limpa `tags`; tags substituem a lista.
- `move_task`: `column` (nome ou id, resolvida no projeto **destino**), `projectId?`. Com `projectId` diferente do da tarefa, usa `moveTaskToProject`; sem `column` nesse caso, vai para a primeira coluna do destino. Senão usa `moveTask` para o fim da coluna. Responde `concluida: true` ao entrar em Done e `reaberta: true` ao sair.
- `complete_task`: vai para a primeira coluna `isDoneColumn`. Sem ela → `"O projeto não tem coluna de concluídas."`; já concluída → `{ ok: true, id, jaConcluida: true }`.
- `reopen_task`: vai para a primeira coluna não-Done. Já aberta → `{ ok: true, id, jaAberta: true }`.
- `delete_task` (cartão): resumo `Excluir tarefa "<título>" do projeto <nome>`.

- [ ] Passo 1: testes:
  - `update_task only touches sent keys and clears with empty string`;
  - `update_task rejects 2026-02-30 and priority "alta"`;
  - `ambiguous title returns candidatos and writes nothing`;
  - `move_task across projects without column lands in the target first column`;
  - `move_task across projects resolves column on the target, clears sprint and credits timer`;
  - `move_task to a column created earlier in the same run works` (`apply` de `create_column`, depois `prepare` + `apply` de `move_task`);
  - `complete_task twice is a no-op`;
  - `delete_task leaves a tombstone`;
  - `task deleted after prepare returns "Tarefa não encontrada." in apply`.
- [ ] Passo 2: o comando da Task 3. Esperado: FALHA porque as ferramentas não existem.
- [ ] Passo 3: implemente.
- [ ] Passo 4: o comando da Task 3. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): edição, movimentação, conclusão e exclusão de tarefas`

### Task 5: Metas e notas

**Arquivos e Interfaces:** os mesmos da Task 4.

Ferramentas:
- `create_goal`: `title`, `target`, `unit?` (padrão `""`), `kind?`, `color?`, `projectId?`.
- `update_goal`: `id` ou `title`, mais `title?`, `target?`, `unit?`, `color?`, `projectId?` (precisa existir).
- `add_goal_progress`: `id` ou `title`, `value?`, `date?`, `label?`. Em meta de conclusão grava valor 1; em meta de quantidade exige `value` > 0. Meta já atingida → `{ ok: true, id, jaConcluida: true }`. Responde `progresso` e `concluida`.
- `delete_goal` (cartão).
- `create_note`: `projectId?`, `content`, `color?`.
- `update_note`: `id`, `content?`, `color?`.
- `delete_note` (cartão).

- [ ] Passo 1: testes:
  - `create_goal rejects target 0 and NaN`;
  - `completion goal forces target 1 and progress writes value 1`;
  - `add_goal_progress on a reached goal is a no-op`;
  - `freeNotePosition`: três `create_note` seguidas ficam em três células distintas e sem sobreposição; uma nota existente em (100,100) empurra a nova para (320,100).
- [ ] Passo 2: o comando da Task 3. Esperado: FALHA.
- [ ] Passo 3: implemente. `freeNotePosition(notes: StickyNote[]): { x: number; y: number }` é exportada de `services/mcpActions.ts`.
- [ ] Passo 4: o comando da Task 3. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): escrita de metas e notas`

### Task 6: Finanças no perfil da sessão

**Arquivos e Interfaces:** os mesmos da Task 4, mais `renameFinancialProfile` (Task 2).

Ferramentas:
- `create_transaction` (cartão): `tableId`, `type`, `amount`, `description`, `date?`, `category?`. Grava `createdAt`. Resumo `Lançar despesa de R$ 1.500,00 em <tabela> — <descrição> — <data>`, com símbolo e formatação por `CURRENCY_CONFIG` e `Intl.NumberFormat` (`pt-BR` para BRL/JPY, `en-US` para USD).
- `update_transaction` (cartão): `tableId`, `id`, mais `amount?`, `type?`, `date?`, `description?`, `category?`.
- `delete_transaction` (cartão).
- `create_financial_table` (cartão): `name`, `currency`, no perfil da sessão.
- `add_financial_category`: `category`.
- `remove_financial_category` (cartão): `category`.
- `create_financial_profile` (cartão): `name`.
- `rename_financial_profile` (cartão): só `name`, aplicado ao perfil da sessão.

- [ ] Passo 1: testes:
  - `table of another profile and missing table give the same refusal`;
  - `transaction id of another profile gives "Transação indisponível nesta sessão MCP."`;
  - `create_transaction stores a 2-place decimal string`;
  - `parseMcpMoney`: `"1500"`→`"1500"`, `"10,5"`→`"10.5"`; recusa `"1.500"`, `"1.500,00"`, `"-5"`, `0`, `12.345`;
  - `update_transaction appends audit and clears reconciledAt when amount changes`;
  - `debt payment transaction cannot be edited or deleted` com o texto exato;
  - `remove_financial_category keeps historical categories and matches case-insensitively`;
  - `create_financial_table uses the session profile and requested currency`;
  - `rename_financial_profile renames only the session profile`;
  - `duplicate profile name returns the existing id`;
  - `resumo formats R$ 1.500,00 and ¥ 1.500`.
- [ ] Passo 2: o comando da Task 3. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: o comando da Task 3. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): transações, tabelas, categorias e perfis financeiros`

### Task 7: Memórias

**Arquivos:** Modificar `src/main/modules/agent/mcp-write-tools.ts`, `src/main/index.ts`. Teste `src/main/__tests__/mcp-write-tools.test.ts`.
**Interfaces:** Produz `prepareMemoryWrite(name, args, deps: { getMemory(id): AiMemory | null; listMemories(): AiMemory[]; now: string }): { ok: false; error: string } | { ok: true; resumo: string; op: McpMemoryOp }`, com `McpMemoryOp = { kind: 'upsert'; memory: AiMemory; redacted: boolean } | { kind: 'archive'; id: string } | { kind: 'delete'; id: string } | { kind: 'resolve'; archiveId: string; keep?: AiMemory }`. Em `index.ts`, o `prepare` da fila chama `prepareMemoryWrite`, e o `execute` chama de novo e aplica com `upsertMemory`, `archiveMemories` ou `deleteMemory`.

Ferramentas:
- `update_memory`: `id`, `title?`, `body?`, `tags?`, `type?` (tipos salváveis). Passa por `buildMemory(existing, …)`, mantém `pinned` e responde `redacted: true` quando limpou segredo. Limites do `save_memory` (200 / 2000 / 12×60).
- `archive_memory`: `id`.
- `unarchive_memory`: `id`, upsert com `archivedAt: null`. Não arquivada → `{ ok: true, id }` sem escrever.
- `delete_memory` (cartão): resumo `Excluir memória "<título>"`.
- `resolve_memory_conflict`: `keepId`, `archiveId`, `body?`. Precisa ser um par de `findConflicts(listMemories())`, senão `"Essas memórias não formam uma contradição apontada por check_memories."`. Arquiva `archiveId` e, com `body`, atualiza `keepId` por `buildMemory`.

- [ ] Passo 1: testes:
  - `update_memory scrubs a secret and keeps pinned`;
  - `handoff memory cannot be updated or resolved`;
  - `archived or missing memory gives the same refusal`;
  - `resolve_memory_conflict archives the loser and never deletes`;
  - `resolve refuses a non-conflicting pair`;
  - `only delete_memory requires approval among memory tools`.
- [ ] Passo 2: `npx vitest run src/main/__tests__/mcp-write-tools.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: mesmo comando + `npx vitest run src/main/__tests__/sagyou-mcp.test.ts`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): edição, arquivamento, exclusão e resolução de memórias`

### Task 8: Verificação, docs e PR

**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md`, `README.md`, `docs/harness-chat-architecture.md`, `docs/specs/2026-10-25-mcp-escrita-completa.md` (frase de `delete_project`, decisão 1).
- [ ] Passo 1: `npm run typecheck && npm run lint && npm test`. Esperado: verde; nenhum erro de lint novo nas linhas alteradas.
- [ ] Passo 2: verificação no app (`npm run dev`) com uma sessão Claude Code ou Codex num projeto de teste:
  - `update_task` e `complete_task` aplicam sem cartão e o board atualiza;
  - `delete_task` mostra o cartão com o resumo exato, e negar não muda nada;
  - `create_transaction` mostra o valor formatado;
  - o projeto ativo não muda após `create_project`.
- [ ] Passo 3: docs:
  - "MCP writes ... execute only after approval" passa a "toda escrita MCP passa pela fila serializada por run; as de `MCP_APPROVAL_REQUIRED` só executam após aprovação" em `CLAUDE.md`, `GUIDE.md` e `docs/harness-chat-architecture.md`;
  - `CLAUDE.md` ganha o parágrafo de `mcp-write-tools.ts`/`services/mcpActions.ts` e a linha `store:mcp:action` na tabela de IPC;
  - `README.md` ganha a lista do que o agente consegue fazer pelo MCP.
- [ ] Passo 4: commit `docs(mcp-escrita-completa): documenta as escritas do MCP`
- [ ] Passo 5: `sagyou-review`, depois `sagyou-pr`.
