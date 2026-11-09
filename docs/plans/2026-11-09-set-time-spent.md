# Plano de implementação: `set_time_spent`

Status: approved by Luis on 2026-11-09
Spec: docs/specs/2026-11-09-set-time-spent.md
Branch: feature/set-time-spent

**Objetivo:** ferramenta MCP que define o total de tempo gasto de uma tarefa, com cartão só
quando diminui e parando o cronômetro sem creditar.

**Arquitetura:** a etapa `prepare` (renderer, `services/mcpActions.ts`) passa a poder pedir
o cartão (`approval: true`); a fila (`mcp-write-queue.ts`) só acrescenta cartões e marca o
pedido como arriscado, e o modo automático não responde cartão arriscado. A escrita usa uma
ação nova do slice de tarefas.

## Restrições Globais

- Testes só no CI (preferência do Luis): "rode" = push e `gh pr checks`.
- `seconds`: inteiro de 0 a 31 536 000; recusa exata: `seconds deve ser um inteiro entre 0 e 31536000.`
- Total atual = `timeSpent` + segundos do cronômetro rodando (`Math.floor((now - startedAt) / 1000)`).
- Cartão quando `seconds < total atual`; igual ou maior: sem cartão.
- Resumo: `Corrigir o tempo de "<título>": <antes> → <depois>`, + ` (para o cronômetro)` com cronômetro rodando. Formato: `0 min`, `45 min`, `2 h 00 min`, `2 h 05 min` (minutos com 2 dígitos depois de horas; segundos truncados).
- Resposta do apply: `{ ok: true, id, resumo, timeSpent, cronometroParado }`.
- `set_time_spent` em `MCP_NO_APPROVAL` (o teste que classifica cada ferramenta uma vez acompanha); listas espelhadas em `main/modules/agent/mcp-write-types.ts` e `renderer/src/types/mcp-actions.ts` (um teste compara).
- Nunca logar o título; o log `mcp`/`tool_call` já existente basta.
- Versão: desktop `1.11.0` (MINOR, ferramenta nova; assume o #54 com 1.10.0 mesclado antes — se não, ajustar na Task 4).

## Ajustes do verificador (decisões do construtor)

- `mcp-write-tools.test.ts:45` pina o total de escritas em 38: passa a 39 (Task 3). O `CLAUDE.md` passa de "37 write tools" para 39 (Task 4).
- Task 2: a única auto-aprovação existente é o laço do `ai:code-agent:set-auto` (`index.ts`); ele passa a usar `autoApprovesPending(pending.request.name, pending.request.risky)`. Não há auto-aprovação na hora de estacionar o cartão. O elo `McpWriteRequest.risky` → `CodeApprovalRequest.risky` (`index.ts`) fica sem teste unitário (o `index.ts` não roda no vitest); só o `CodeApprovalRequest` do `index.ts` ganha o campo.
- Foco 2: teste novo no `mcpActions.test.ts` mostrando que o `prepare` não mexe em `activeTimers` nem em `timeSpent` (a negação é da fila: sem apply, nada muda).
- Teste do slice: `renderer/src/__tests__/store/kanban.test.ts`, onde ficam os testes de cronômetro.
- `agent-task-timers.ts`: ramo novo em `record` — `set_time_spent` libera o cronômetro rastreado só quando `result.cronometroParado === true`.
- Resposta do apply: a da spec mais `resumo` (o `done(...)` já o inclui).
- Task 4: `agent-briefing.test.ts:84` pina a frase do cronômetro e acompanha a mudança; o commit vem antes do push.
- Handoff: uma tarefa cujo cronômetro a sessão iniciou continua "pendente" no handoff depois do `set_time_spent`, como já acontece com o `stop_task_timer` (fora do escopo).

## Foco de Review

1. **Modo automático da sessão ligado e o agente diminui o tempo:** o cartão aparece mesmo assim (o auto não responde cartão pedido pelo `prepare`). Testado na Task 2.
2. **Cronômetro rodando, cartão negado ou expirado:** nada muda e o cronômetro continua rodando. Testado na Task 3.
3. **Cronômetro iniciado pela própria sessão do Fleet e parado pela correção:** sai do rastreamento da sessão (não é parado de novo no fim dela). Testado na Task 3.
4. **Escrita que já exige cartão pelo nome** nunca perde o cartão por um `prepare` (a fila só acrescenta). Testado na Task 1.
5. **Tempo da tarefa em dados existentes:** tarefa sem `timeSpent` (antiga) conta como 0; gravar 0 é válido. Testado na Task 3.

### Task 1: a fila aceita cartão pedido pelo `prepare`

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-write-queue.ts`; Teste `apps/desktop/src/main/__tests__/mcp-write-queue.test.ts`

**Interfaces:** Produz `McpWritePrepare<T> = () => Promise<{ resumo: string; approval?: boolean } | { refuse: T }>` e `McpWriteRequest.risky?: boolean` (o `approve` recebe `risky: true` quando o cartão veio do `prepare`).

- [ ] Passo 1: testes: `approval: false` + prepare `{ resumo, approval: true }` → `approve` chamado com `risky: true` e o resumo; prepare sem `approval` mantém `approval: false` (sem cartão); `approval: true` (pelo nome) + prepare `{ approval: false }` → cartão continua.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: em `drain`, `if (prepared.approval === true) { write.approval = true; write.risky = true }`; repassar `risky` ao `approve`.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): o prepare pode pedir o cartão de aprovação`

### Task 2: cartão pedido pelo `prepare` é arriscado

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-write-tools.ts` (`autoApprovesPending(name, risky?)`), `apps/desktop/src/main/index.ts` (`requestMcpWriteApproval` recebe `risky` e grava em `CodeApprovalRequest.risky`; o laço do `ai:code-agent:set-auto` e qualquer auto-aprovação na hora de estacionar o cartão usam `autoApprovesPending(name, risky)`; o wiring do `prepare` em `write` repassa `approval: prepared.approval === true`), o tipo `CodeApprovalRequest` onde estiver; Teste `apps/desktop/src/main/__tests__/mcp-write-tools.test.ts` (ou o arquivo que já testa `autoApprovesPending`)

- [ ] Passo 1: testes: `autoApprovesPending('mcp:set_time_spent', true)` → false; sem `risky` → true; `mcp:delete_task` continua false.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): o modo automático não responde cartão pedido pelo prepare`

### Task 3: a ferramenta `set_time_spent`

**Arquivos:**
- Modificar `apps/desktop/src/main/modules/agent/mcp-write-tools.ts` (definição `tool('set_time_spent', 'Define o tempo gasto total de uma tarefa (corrige um cronômetro que ficou ligado à toa). Diminuir pede aprovação; com o cronômetro rodando, ele é parado sem somar.', { projectId, ...taskRef, seconds: { type: 'integer', minimum: 0, maximum: 31536000, description: 'Total em segundos (0 a 31536000).' } }, ['seconds'])` e `MCP_NO_APPROVAL`), `mcp-write-types.ts`, `renderer/src/types/mcp-actions.ts`, `apps/desktop/src/main/modules/agent/agent-task-timers.ts` (`set_time_spent` com `cronometroParado: true` libera o cronômetro rastreado da sessão), `renderer/src/store/slices/tasks.ts` (ação `setTimeSpent(taskId: string, seconds: number): { stoppedTimer: boolean }` — remove o cronômetro da tarefa **sem** creditar, grava `timeSpent`, `updatedAt`, `_persist()`), `renderer/src/services/mcpActions.ts` (handler `setTimeSpent` + helper `formatDuration(seconds)` exportado)
- Teste `renderer/src/__tests__/services/mcpActions.test.ts` (ou o arquivo que já testa `add_time_spent`), `renderer/src/__tests__/store/` (o teste do slice de tarefas que cobre timers), `apps/desktop/src/main/__tests__/agent-task-timers.test.ts`, o teste que pina a classificação e as listas espelhadas

- [ ] Passo 1: testes:
  - `formatDuration`: 0 → `0 min`; 59 → `0 min`; 2700 → `45 min`; 7200 → `2 h 00 min`; 7500 → `2 h 05 min`.
  - prepare com `timeSpent` 10800, sem cronômetro, `seconds` 7200 → `{ ok, resumo: 'Corrigir o tempo de "T": 3 h 00 min → 2 h 00 min', approval: true }`; `seconds` 14400 → sem `approval`.
  - cronômetro rodando há 3 h sobre 3600 gravados, `seconds` 3600 → `approval: true`, resumo com ` (para o cronômetro)`; o prepare não muda nada.
  - apply → cronômetro removido, `timeSpent` 3600 (nada do cronômetro somado), resposta `cronometroParado: true`.
  - `seconds` -1 / 31536001 / 1.5 / texto → recusa exata; tarefa sem `timeSpent` aceita `seconds` 0.
  - `agent-task-timers`: cronômetro iniciado pela sessão + `set_time_spent` com `cronometroParado: true` → não é parado no fim da sessão.
  - classificação: `set_time_spent` aparece exatamente uma vez (em `MCP_NO_APPROVAL`); listas espelhadas iguais.
- [ ] Passo 2: rode (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): set_time_spent corrige o tempo gasto de uma tarefa`

### Task 4: docs, versão e PR

**Arquivos:** `CLAUDE.md` (MCP write tools: 38 escritas, `set_time_spent`; a regra "o cartão é decidido pelo nome" ganha "ou pelo `prepare`, que só acrescenta, e o auto não responde"), `GUIDE.md` se citar a contagem/regra, `apps/desktop/src/main/modules/agent/agent-briefing.ts` (a linha do cronômetro cita `set_time_spent` para corrigir tempo ocioso), `apps/desktop/package.json` + `package-lock.json` 1.11.0.

- [ ] Passo 1: atualize.
- [ ] Passo 2: push, `gh pr checks`.
- [ ] Passo 3: `sagyou-review` (+ `sagyou-security-reviewer`: MCP e aprovação), `sagyou-pr`.
- [ ] Passo 4: commit `docs(set-time-spent): docs e versão`
