# Plano de implementação: Logs de diagnóstico

Status: approved by Luis on 2026-10-27
Spec: docs/specs/2026-10-27-logs-diagnostico.md
Branch: feature/logs-diagnostico

**Objetivo:** logs JSONL diários em `userData/logs/`, sem segredos, e a ferramenta MCP `read_logs`.

**Arquitetura:** `src/main/modules/logs/logger.ts` exporta `createLogger({ dir, now?, consoleInDev? })` → `{ info, warn, error, readLogs(query), prune() }` e um singleton `log` configurado em `app.whenReady` (antes disso, no-op). `sanitizeLogData` (mesmo arquivo) aplica a lista de chaves proibidas, primitivos, `scrubSecrets` e corte de 500 caracteres. O broker MCP recebe `readLogs` como dependência opcional e registra cada `tools/call` via callback `onToolCall`.

## Restrições Globais

- Nunca gravar: token MCP, conteúdo/título/descrição de tasks, valores financeiros, argumentos de ferramentas. Chaves proibidas: `token`, `content`, `body`, `title`, `description`, `amount`, `value`, `args`, `arguments`, `password`.
- Falha de escrita ou leitura nunca lança para quem chamou.
- Retenção 14 dias; arquivo do dia > 5 MB só aceita `warn`/`error`.
- `read_logs`: `limit` 1–200 (padrão 100), `since` padrão `24h`, mais recentes primeiro, `truncated`.
- Logs fora do backup e do SQLite.

## Foco de Review

1. **Segredo em mensagem de erro** (ex.: erro com `Bearer abc…`) sai redigido. Task 1.
2. **Chave proibida aninhada ou objeto em `data`** não vaza (objetos são descartados). Task 1.
3. **Disco cheio / pasta sem permissão:** app segue. Task 1.
4. **`read_logs` sem permissão na sessão** continua recusado como as outras ferramentas. Task 3.
5. **Registro de MCP** não inclui argumentos nem resultado. Task 3.

### Task 1: Logger

**Arquivos:** Criar `src/main/modules/logs/logger.ts`. Teste `src/main/__tests__/logger.test.ts` (diretório temporário, relógio injetado).

- [ ] Passo 1: testes que falham: grava linha JSON no arquivo do dia; virada do dia troca de arquivo; `prune` apaga > 14 dias e mantém o resto (e ignora arquivos com outro nome); segredo em `msg`/`data` é redigido; chave proibida e objeto aninhado são descartados; string > 500 é cortada; > 5 MB descarta `info` e aceita `error`; diretório inválido não lança; `readLogs` filtra nível/área/período, ordena do mais recente e respeita `limit`/`truncated`; linha corrompida é ignorada.
- [ ] Passo 2: `npx vitest run src/main/__tests__/logger.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: PASSA; `npm run typecheck:node`.
- [ ] Passo 5: commit `feat(logs): logger JSONL diário com redação de segredos`.

### Task 2: Ligar o logger no app

**Arquivos:** Modificar `src/main/index.ts`, `src/main/store.ts`, `src/main/handlers/backup.ts`, `src/main/modules/files/backup-repair.ts` (se for o ponto do reparo).

- [ ] Passo 1: configurar `log` com `userData/logs` no `whenReady`, `prune()` na inicialização; `app/started`; `uncaughtException`, `unhandledRejection`, `render-process-gone` → `error`.
- [ ] Passo 2: trocar os `console.*` do main por `log.*` (`store/migration`, `app/...`).
- [ ] Passo 3: eventos de backup (exported/imported/auto_snapshot/repaired + falhas), PTY (`pty/started`, `pty/exited`), entrega (`delivery/applied|failed`), aprovação MCP (`mcp/approval`).
- [ ] Passo 4: `npm run typecheck` e `npm test` (testes existentes continuam verdes; o logger sem configurar é no-op).
- [ ] Passo 5: commit `feat(logs): registrar migrações, backup, PTY, MCP e entrega`.

### Task 3: Ferramenta MCP `read_logs`

**Arquivos:** Modificar `src/main/modules/agent/sagyou-mcp.ts`, `agent-mcp-session.ts` (incluir em `CODE_EXECUTOR_MCP_PERMISSIONS`), `src/main/index.ts` (dep `readLogs`, callback `onToolCall`). Teste em `src/main/__tests__/sagyou-mcp.test.ts`.

- [ ] Passo 1: testes que falham: `tools/list` mostra `read_logs` com schema (`level`, `since`, `area`, `limit`); chamada devolve o JSON de `readLogs` com os argumentos normalizados; `limit` 500 vira 200; sessão sem a permissão recebe `Ferramenta indisponível nesta sessão MCP.`; `onToolCall` recebe `{ runId, tool, outcome, ms }` e nada de argumentos.
- [ ] Passo 2: FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(mcp): ferramenta read_logs`.

### Task 4: Docs e verificação

- [ ] `GUIDE.md` e `CLAUDE.md`: onde ficam os logs, o que nunca é gravado, `read_logs`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] Manual (`npm run dev`): abrir o app, conferir `userData/logs/<hoje>.jsonl` com `app/started`; rodar um agente e chamar `read_logs`.
