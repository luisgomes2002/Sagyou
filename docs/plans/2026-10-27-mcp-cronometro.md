# Plano de implementação: MCP cronômetro das tasks

Status: approved by Luis on 2026-10-27
Spec: docs/specs/2026-10-27-mcp-cronometro.md
Branch: feature/mcp-cronometro

**Objetivo:** ferramentas MCP `start_task_timer`, `stop_task_timer` e `add_time_spent`, timers da sessão parados no fim da run e regra no briefing.

**Arquitetura:** as três entram em `MCP_RENDERER_WRITE_TOOLS` (main e espelho do renderer) e em `MCP_NO_APPROVAL`. Os handlers ficam em `services/mcpActions.ts` e usam `startTimer`, `stopTimer` e `addTimeSpent` do store. No main, um módulo pequeno `agent/agent-task-timers.ts` guarda `runId → Set<taskId>`. O `write` do broker o atualiza depois de cada escrita ok. A limpeza da run chama `stopAll(runId)`, que aplica `stop_task_timer` direto pelo `rendererMcpActions` (sem a fila, que já foi rejeitada).

## Restrições Globais

- Sem mudança de dados.
- Sem cartão de aprovação para as três ferramentas.
- Textos exatos: `A tarefa já está concluída.`, `O cronômetro desta tarefa não está rodando.`, `seconds deve ser um inteiro entre 1 e 86400.`, resumos `Iniciar cronômetro de "<t>"`, `Parar cronômetro de "<t>"`, `Somar <n> s ao tempo de "<t>"`.
- O fim da run só para timers que a run iniciou.

## Foco de Review

1. **Timer iniciado à mão** não é parado no fim da sessão. Task 3.
2. **Run termina com a fila rejeitada:** a parada não depende da fila e não lança. Task 3.
3. **`complete_task` com timer ativo** soma o tempo (comportamento atual) e tira a task da lista da run. Tasks 2 e 3.
4. **Escopo:** task de outro projeto é recusada como nas outras ferramentas. Task 2.

### Task 1: Declarar as ferramentas

**Arquivos:** `src/main/modules/agent/mcp-write-types.ts`, `src/renderer/src/types/mcp-actions.ts`, `src/main/modules/agent/mcp-write-tools.ts`. Teste `src/main/__tests__/mcp-write-tools.test.ts`.

- [ ] Passo 1: testes: as três aparecem nos tools com `taskRef` + `projectId` (e `seconds` integer 1..86400 obrigatório em `add_time_spent`); estão em `MCP_NO_APPROVAL`; o teste de espelho main/renderer continua igual.
- [ ] Passo 2: FALHA. Passo 3: implementar. Passo 4: PASSA. Passo 5: commit `feat(mcp): declarar ferramentas de cronômetro`.

### Task 2: Handlers no renderer

**Arquivos:** `src/renderer/src/services/mcpActions.ts`. Teste `src/renderer/src/__tests__/services/mcpActions.test.ts`.

- [ ] Passo 1: testes: start cria timer e start duplo responde `jaRodando`; start em task concluída recusa; stop soma em `timeSpent` (Date.now mockado) e devolve o total; stop sem timer recusa; `add_time_spent` soma e recusa 0, 86401, 1.5 e texto; prepare não escreve; task de outro projeto recusada; `complete_task` com timer ativo soma o tempo.
- [ ] Passo 2: FALHA. Passo 3: implementar. Passo 4: PASSA. Passo 5: commit `feat(mcp): cronômetro das tasks pelo MCP`.

### Task 3: Parar os timers da sessão no fim da run

**Arquivos:** criar `src/main/modules/agent/agent-task-timers.ts`; modificar `src/main/index.ts` (no `write` e nos dois pontos de `mcpWriteQueue.rejectRun(runId)`). Teste `src/main/__tests__/agent-task-timers.test.ts`.
**Interfaces:** `createRunTaskTimers(stop: (runId, taskId) => Promise<unknown>)` → `{ record(runId, toolName, result), stopAll(runId): Promise<void> }`.

- [ ] Passo 1: testes: start ok registra; stop/complete/delete ok tiram; resultado `ok:false` não registra; `stopAll` chama `stop` uma vez por task da run e esquece a run; outra run não é afetada; `stop` que rejeita não impede as outras nem lança.
- [ ] Passo 2: FALHA. Passo 3: implementar e ligar no `index.ts` (`stop` = `rendererMcpActions.request({ phase: 'apply', name: 'stop_task_timer', args: { id }, scope })`, com o escopo da sessão guardado no registro).
- [ ] Passo 4: PASSA; `npm run typecheck`. Passo 5: commit `feat(mcp): parar no fim da sessão os timers que ela iniciou`.

### Task 4: Briefing e docs

**Arquivos:** `src/main/modules/agent/agent-briefing.ts` (teste `agent-briefing.test.ts`), `CLAUDE.md` (lista de ferramentas MCP), `GUIDE.md` se citar a lista.

- [ ] Passo 1: teste: o briefing contém a frase da spec. Passo 2: FALHA. Passo 3: implementar e atualizar docs. Passo 4: PASSA. Passo 5: commit `feat(agente): briefing manda cronometrar as tasks`.

### Task 5: Verificação

- [ ] `npm run typecheck`, `npm run lint` (sem erro novo), `npm test`.
- [ ] Manual: sessão de agente no Fleet → pedir para trabalhar numa task → ver o timer rodando no card → `complete_task` → `timeSpent` somado; e Stop no meio → timer parado.
