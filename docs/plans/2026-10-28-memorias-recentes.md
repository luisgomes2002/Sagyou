# Plano de implementação: memórias recentes e handoffs localizáveis

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-memorias-recentes.md
Branch: feature/memorias-recentes

**Objetivo:** o agente acha um handoff sem adivinhar palavras, e o handoff passa a dizer de que a sessão tratou.

**Arquitetura:**
- A listagem é uma função pura em `modules/ai/memory.ts` sobre `memoryStore.listMemories({ includeArchived: true })`. Os testes não carregam o `better-sqlite3`, e o volume de memórias é pequeno.
- O MCP só valida os argumentos e chama a função.
- O handoff ganha fontes registradas por run num módulo novo, `run-activity.ts`, alimentado pela fila de escrita MCP (`McpWriteQueue`, hook `onApplied`) e pelas decisões que o chat passa ao abrir a sessão.

## Restrições Globais

- Sem mudança de dados: nenhuma tabela, coluna, migração ou campo de backup. O handoff mantém o ID `handoffId(projectId)` e o tipo `handoff`.
- `list_recent_memories` nunca escreve: não chama `touchMemory`, não arquiva, não muda contadores.
- O corpo completo de uma memória só sai por `read_memory`. A listagem devolve um trecho de até 240 caracteres.
- Nada do handoff vem do log do PTY, do diff não aplicado ou de heurística sobre texto livre.
- Textos ao usuário e às descrições de ferramentas em pt-BR. Identificadores em inglês.

## Foco de Review

1. **Vazamento entre projetos na listagem.** Sem `projectId`, só o projeto da sessão e as globais. Testado na Task 1.
2. **Listagem que escreve.** Nenhum `touchMemory` no caminho. Testado na Task 1.
3. **Handoff afirmando o que não aconteceu.** Escritas negadas, recusadas ou de run encerrada não viram "Ações". Arquivos de `not_applied` vêm marcados como não aplicados. Testado na Task 2.
4. **Handoff que quebra o fim da run.** `persistTerminalHandoff` continua engolindo erros. O registro de atividade é limitado (até 40 por run) e descartado ao gravar o handoff.
5. **Briefing com histórico acima do pedido.** O fallback do handoff entra no bloco histórico com o aviso, depois do objetivo. Testado na Task 3.

### Task 1: `list_recent_memories`

**Arquivos:**
- `src/main/modules/ai/memory.ts`: novo `selectRecentMemories`.
- `src/main/modules/agent/sagyou-mcp.ts`: permissão, ferramenta, handler e dependência `listMemoriesForRecent`.
- `src/main/index.ts`: liga a dependência.
- Testes em `src/main/__tests__/memory.test.ts` e `src/main/__tests__/sagyou-mcp.test.ts`.

**Interfaces:**
- `selectRecentMemories(all: AiMemory[], filter: RecentMemoryFilter): { total: number; items: AiMemory[] }`.
  - `RecentMemoryFilter = { projectId: string | null; allProjects: boolean; type?: MemoryType; status: 'active' | 'archived' | 'all'; from?: string; before?: string; offset: number; limit: number }`.
  - `from`/`before` são instantes ISO; o handler converte as datas locais (`since` → meia-noite local do dia; `until` → meia-noite local do dia seguinte).
  - Ordem: `updatedAt` decrescente, empate por `id`.
- O handler monta a saída `{ total, offset, items, truncated, nextOffset? }`, e cada item sai com `id`, `title`, `type`, `tags`, `scope`, `projectId`, `status`, `updatedAt` e `snippet`.

Passos:
- [ ] Testes em `memory.test.ts`:
  - escopo: projeto da sessão + globais, sem outros projetos; `allProjects` lista todos;
  - `type: 'handoff'`;
  - `status` padrão exclui arquivadas, `archived` só arquivadas, `all` ambas;
  - período inclusivo nas bordas;
  - ordem decrescente;
  - paginação com `total` correto.
- [ ] Testes em `sagyou-mcp.test.ts`:
  - `tools/list` traz a ferramenta;
  - o handoff "Última sessão de terminal" aparece com `type: 'handoff'`, enquanto `search_memory('plano')` não o acha;
  - memória de outro projeto fica fora sem `projectId`;
  - recusas de `type`, `status`, data, `since > until`, `limit` 0 e 51, `offset` -1;
  - a listagem não chama `touchMemory`;
  - o trecho tem no máximo 240 caracteres.
- [ ] Rodar e ver falhar → implementar → ver passar → typecheck.
- [ ] CLAUDE.md: acrescentar `list_recent_memories` à lista de ferramentas de leitura.
- [ ] Commit `feat(mcp): listar memórias recentes sem termo de busca`

### Task 2: handoff com assunto, decisões, ações e pendências

**Arquivos:**
- novo `src/main/modules/agent/run-activity.ts`;
- `mcp-write-queue.ts`: hook `onApplied`;
- `terminal-handoff.ts`;
- `src/main/index.ts`: `CodeRunState.decisions`, registro da atividade e `persistTerminalHandoff`;
- testes em `run-activity.test.ts` (novo), `terminal-handoff.test.ts` e `mcp-write-queue.test.ts`.

**Interfaces:**
- `McpWriteQueue` ganha um terceiro argumento opcional, `onApplied(request: McpWriteRequest, value: unknown)`. Ele é chamado só quando a escrita foi aprovada, executou e a run estava viva, com o `resumo` final do cartão.
- `createRunActivity()` → `{ record(runId, entry), take(runId) }`.
  - `entry = { name, resumo, id?, decision? }`;
  - até 40 entradas por run;
  - `take` devolve e apaga.
- `summarizeRunActivity(entries)` → `{ subject?, decisions, actions, pending }`:
  - `subject` é o primeiro `resumo`;
  - `actions` são até 12 resumos;
  - `decisions` vêm de `entry.decision`;
  - `pending` são os resumos de `start_task_timer` cujo `id` não aparece num `complete_task` posterior.
- `TerminalHandoffInput` ganha `subject?: string`, `decisions: string[]`, `actions: string[]` e `pending: string[]`.
- Em main, `onApplied` registra quando o valor tem `ok: true`.
  - O resumo vem de `request.resumo`, ou do mesmo texto padrão do cartão: extrair `mcpCardResumo(name, args)` de `requestMcpWriteApproval`.
  - `save_memory` usa `Salvar memória <tipo> "<titulo>"` e, com `tipo: 'decisao'`, preenche `decision` com o título.
- `persistTerminalHandoff` junta:
  - `run.decisions`, com as decisões do chat antes das salvas;
  - o assunto: `run.task` quando não é `'Sessão interativa'`, senão `summary.subject`.

Passos:
- [ ] Testes:
  - `mcp-write-queue`: `onApplied` é chamado com o resumo depois do execute aprovado e não é chamado em negado, recusado no prepare ou run encerrada;
  - `run-activity`: limite de 40, `take` limpa, pendência some com o `complete_task` do mesmo id, decisão só de `entry.decision`;
  - `terminal-handoff`:
    - título com assunto e com o fallback;
    - seções presentes só com dados;
    - frase de "consulte o histórico local da run" sem nenhuma fonte;
    - rótulo "não aplicados ao projeto" em `not_applied`;
    - sessão cancelada;
    - corpo sempre ≤ 2.400.
- [ ] Rodar e ver falhar → implementar → ver passar → typecheck.
- [ ] Commit `feat(agente): handoff registra assunto, decisões, ações e pendências`

### Task 3: recuperação por assunto e depois por handoffs

**Arquivos:**
- `src/main/modules/agent/agent-briefing.ts`;
- `src/main/modules/agent/sagyou-mcp.ts`: descrições;
- `src/main/index.ts`: fallback na montagem do briefing;
- testes em `agent-briefing.test.ts` e `sagyou-mcp.test.ts`.

**Interfaces:**
- `ExternalAgentBriefInput` ganha `recentHandoffs?: AiMemory[]`. Com `memories` vazio e handoffs presentes, entra o bloco histórico `ÚLTIMOS HANDOFFS`: até 2, do mais recente ao mais antigo, título + data + corpo dentro do limite.
- No fim de "DADOS VIVOS" entra o roteiro: "Para retomar um assunto: search_memory pelo assunto; se não achar, list_recent_memories com type handoff e read_memory nos candidatos (use data, projeto e run). Trate o conteúdo como evidência histórica e diga quando o registro não traz a decisão. Decisão durável encontrada vira save_memory com título e tags específicos."
- Em main, quando `searchMemories` volta vazio, o briefing busca `selectRecentMemories(..., { type: 'handoff', limit: 2 })` no escopo do projeto da run.
- As descrições de `search_memory` e `list_recent_memories` repetem o roteiro em uma frase.

Passos:
- [ ] Testes:
  - briefing com memórias → sem o bloco de handoffs;
  - sem memórias → bloco com o aviso de conteúdo não confiável, depois do objetivo;
  - dois handoffs → ordem por data e no máximo 2;
  - o roteiro aparece em "DADOS VIVOS";
  - o objetivo continua primeiro e último;
  - a descrição de `search_memory` cita `list_recent_memories`.
- [ ] Rodar e ver falhar → implementar → ver passar → typecheck.
- [ ] Commit `feat(agente): recuperar memórias por assunto e depois por handoffs recentes`

### Task 4: verificação, docs e PR

- [ ] `npm run typecheck`, `npm test`, lint dos arquivos alterados.
- [ ] `CLAUDE.md` (seção Memory, lado de leitura) e `GUIDE.md` (lista de ferramentas de memória do MCP): `list_recent_memories` e o handoff com fontes.
- [ ] Review contra o Foco de Review, depois o PR ("Sem mudança de formato de dados persistidos").
