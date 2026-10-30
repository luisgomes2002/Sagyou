# Plano de implementação: MCP — credencial vale enquanto o terminal estiver aberto

Status: approved by Luis on 2026-10-30
Spec: docs/specs/2026-10-30-mcp-sem-expiracao.md
Branch: feature/mcp-sem-expiracao

**Objetivo:** a credencial MCP de uma sessão do Fleet deixa de expirar em 2 h e passa a valer até a sessão terminar.
**Arquitetura:** `McpSession.expiresAt` vira opcional (ausente = sem prazo) e o broker ganha a dependência opcional `isRunLive(runId)`, conferida em toda requisição junto do prazo. O main deixa de passar prazo às sessões do Fleet e injeta o `isMcpRunLive` que a fila de escrita já usa. A revogação no `cleanup` continua como está.

## Restrições Globais

- Mensagem de recusa inalterada: `Sessão MCP inválida ou expirada.`, e o token recusado é descartado (`sessions.delete`).
- Um `expiresAt` presente continua sendo respeitado (`expiresAt <= Date.now()` recusa).
- `isRunLive` ausente equivale a "sempre viva" (não quebra os testes nem usos existentes).
- Cartões de aprovação não mudam: `MCP_APPROVAL_TIMEOUT_MS` (5 min) e `MCP_CLIENT_TOOL_TIMEOUT_SEC` intocados.
- Sem mudança de dados: nada persiste; nenhum normalizador ou migração.
- Token nunca vai para log nem UI (regra existente).

## Foco de Review

1. Token de run encerrada que, por algum caminho, não foi revogado: recusado na próxima chamada e removido do mapa. Testado na Task 1.
2. Sessão sem `expiresAt` com relógio muito adiante (mais de 2 h): aceita enquanto a run está viva. Testado na Task 1.
3. Sessão com `expiresAt` no passado: continua recusada (sem regressão para testes/uso futuro). Testado na Task 1.
4. Corrida no início da sessão: a CLI só chama o MCP depois do spawn, e `isMcpRunLive` exige `externalChild` em sessão interativa. O `grant` acontece antes do spawn, mas nenhuma chamada chega antes dele. Conferir no app que a primeira chamada MCP de uma sessão nova funciona. Verificação manual na Task 3, Passo 3 (sem teste automatizado: o spawn real do PTY não roda no vitest).
5. `prepareAgentMcpSession` sem `expiresAt` não grava a chave no `grant` (nem `undefined` explícito que mude a igualdade nos testes). Testado na Task 2.

### Task 1: broker aceita sessão sem prazo e confere se a run está viva

**Arquivos:** Modificar `src/main/modules/agent/sagyou-mcp.ts` / Teste `src/main/__tests__/sagyou-mcp.test.ts`
**Interfaces:** Produz `McpSession.expiresAt?: number` e `McpBrokerDeps.isRunLive?: (runId: string) => boolean`.

- [ ] Passo 1: escreva os testes que falham em `sagyou-mcp.test.ts`:
  - `aceita sessão sem expiresAt depois de mais de 2 h`: `grant` sem `expiresAt`, `vi.spyOn(Date, 'now')` avançado em `3 * 60 * 60 * 1000` (o broker usa `Date.now()` direto; não há `deps.now`, decisão do construtor: continua assim), `tools/call` `read_tasks` responde sem `error`.
  - `recusa token de run que não está mais viva`: `let vivo = false` e `isRunLive: () => vivo`; sessão de `run-morta` sem prazo; resposta com `error.message` `Sessão MCP inválida ou expirada.`; depois `vivo = true` e uma segunda chamada com o mesmo token continua recusada (o token foi descartado).
  - O teste existente de `expiresAt: Date.now() - 1` continua passando sem alteração.
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/sagyou-mcp.test.ts`. Esperado: o teste de run morta FALHA porque `isRunLive` é ignorado. O teste sem prazo já passa em runtime (`undefined <= n` é `false`), mas falha em `npm run typecheck` porque `expiresAt` é obrigatório; ele fica como guarda contra alguém voltar a exigir prazo.
- [ ] Passo 3: implemente em `startSagyouMcpBroker` a checagem `!session || (session.expiresAt !== undefined && session.expiresAt <= Date.now()) || !(deps.isRunLive?.(session.runId) ?? true)`; torne `expiresAt` opcional em `McpSession`; atualize o comentário do broker ("random, expiring capability" → válida enquanto a run vive).
- [ ] Passo 4: rode `npx vitest run src/main/__tests__/sagyou-mcp.test.ts` e `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): credencial sem prazo vale enquanto a run vive`

### Task 2: sessões do Fleet sem prazo e broker ligado ao `isMcpRunLive`

**Arquivos:** Modificar `src/main/modules/agent/agent-mcp-session.ts`, `src/main/index.ts` / Teste `src/main/__tests__/agent-infrastructure.test.ts`
**Interfaces:** Consome `McpSession.expiresAt?` e `McpBrokerDeps.isRunLive?` (Task 1).

- [ ] Passo 1: teste em `agent-infrastructure.test.ts`: `prepareAgentMcpSession` chamado sem `expiresAt` concede `{ token, runId, projectId, financialProfileId, permissions }` e o objeto concedido não tem a chave `expiresAt` (`expect('expiresAt' in granted[0]).toBe(false)`).
- [ ] Passo 2: rode `npx vitest run src/main/__tests__/agent-infrastructure.test.ts`. Esperado: FALHA na asserção, porque o `grant` copia `expiresAt: undefined` (a chave existe).
- [ ] Passo 3: `PrepareMcpSessionOptions.expiresAt?: number`; no `grant`, espalhe `expiresAt` só quando definido. Em `src/main/index.ts`, remova `expiresAt: Date.now() + 2 * 60 * 60 * 1000` da chamada de `prepareAgentMcpSession` e passe `isRunLive: (runId) => isMcpRunLive(runId)` em `startSagyouMcpBroker` (arrow, porque `codeRuns` é declarado depois do broker; a função é chamada só em tempo de requisição).
- [ ] Passo 4: rode `npx vitest run src/main/__tests__/agent-infrastructure.test.ts src/main/__tests__/handlers.test.ts` e `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(agent): sessões do Fleet sem prazo fixo de MCP`

### Task 3: documentação, suíte completa e PR

**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md` (e `docs/harness-chat-architecture.md` se citar o prazo; hoje não cita).

- [ ] Passo 1: `CLAUDE.md` (Agent-first, Boundaries): trocar "expire after at most two hours and are revoked on every terminal path" por "live exactly as long as their run: no fixed expiry, revoked on every terminal path, and refused by the broker once `isMcpRunLive` reports the run ended". `GUIDE.md`: trocar "expira em no máximo duas horas" por "vale enquanto a sessão estiver aberta e é revogada em todo encerramento".
- [ ] Passo 2: rode `npm run lint`, `npm run typecheck`, `npm test` (via `sagyou-test-runner`). Esperado: tudo passa.
- [ ] Passo 3: verificação no app pelo usuário (`npm run dev`): abrir sessão nova no Fleet, chamar uma ferramenta MCP (ex.: `list_projects`), sair do CLI e confirmar que a sessão encerrou. Sem mudança de UI.
- [ ] Passo 4: commit `docs(mcp): credencial vale pela vida da sessão`; seguir `sagyou-review` e `sagyou-pr`.
