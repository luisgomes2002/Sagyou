# Plano de implementação: MCP externo

Status: approved by Luis on 2026-11-02
Spec: docs/specs/2026-11-02-mcp-externo.md
Branch: feature/mcp-externo

**Objetivo:** um Claude Code fora do Fleet acessa o Sagyou por um token de 30 dias, com escopo,
sem escritas arriscadas.

**Arquitetura:** `modules/agent/mcp-external.ts` guarda e confere o token (hash em
`userData/mcp-external.json`). O broker ganha uma segunda forma de autenticar (`externalSession`)
que devolve uma `McpSession` de run fixa `external`, e recusa as arriscadas dessa run antes de
qualquer leitura ou escrita. O main grava a porta e a ponte em `userData`, registra
`mcp-external:*` e avisa o vencimento; o renderer ganha a seção "Acesso MCP externo".

## Restrições Globais

- Mensagens exatas: vencido "Token expirado: renove em Configurações → Acesso MCP externo"; arriscada "Esta ação exige aprovação: faça pelo Sagyou ou por uma sessão do Fleet"; inválido "Sessão MCP inválida ou expirada." (a de hoje); só leitura "Ferramenta indisponível nesta sessão MCP." (a de hoje).
- Arriscadas pelo token externo: `MCP_APPROVAL_REQUIRED` ∪ {`save_memory`, `criar_task`}.
- Token: `randomBytes(32).toString('base64url')`; hash SHA-256 hex; comparação `timingSafeEqual`; validade 30 dias (`EXTERNAL_TOKEN_TTL_MS = 30 * 86400000`); aviso com ≤ 3 dias; último uso gravado no máximo 1×/min.
- Arquivos: `mcp-external.json` / `mcp-external-dev.json` (0600, `.tmp` + rename), `mcp-external-bridge.cjs`, `mcp-external-port` (dev: `mcp-external-port-dev`). Fora de todo backup; `wipeTargets` inclui o json (dev e prod).
- Run fixa `EXTERNAL_RUN_ID = 'external'`. `isMcpRunLive('external')` = token válido agora.
- Nunca logar token, hash nem argumentos. Eventos `mcp`: `external_token_created`, `external_token_revoked`, `external_refused` (`reason`: `expired` | `risky`).
- Comando: `claude mcp add sagyou-externo --scope user -e ELECTRON_RUN_AS_NODE=1 -e SAGYOU_MCP_TOKEN=<token> -e SAGYOU_MCP_PORT_FILE="<portFile>" -- "<execPath>" "<bridgePath>"`.
- IPC registrado **depois** de `protectDataIpc`: `mcp-external:status`, `mcp-external:create` (`{ projectId: string | null, financialProfileId: string, mode: 'read' | 'read-write' }`), `mcp-external:renew`, `mcp-external:revoke`. `create`/`renew` devolvem `{ token, command, status }` uma vez; `status` nunca devolve token nem hash.
- Cronômetros iniciados pela run `external` não entram em `runTaskTimers`.
- Testes não rodam localmente (preferência do Luis): verificação pelo CI do PR. Versão desktop 1.4.0.

### Respostas à checagem do plano (decisões do construtor)

- **Conjuntos por modo** (no `sagyou-mcp.ts`, que é dono de `MCP_PERMISSIONS`): `EXTERNAL_WRITE_NAMES = WRITE_TOOL_NAMES ∪ {save_memory, criar_task}`; `externalPermissions('read') = MCP_PERMISSIONS − EXTERNAL_WRITE_NAMES`; `externalPermissions('read-write') = MCP_PERMISSIONS`. Os testes da Task 2 usam esses nomes.
- **Sem ciclo de import:** novo `modules/agent/mcp-external-policy.ts` (importa só `MCP_APPROVAL_REQUIRED` de `mcp-write-tools`) com `EXTERNAL_RUN_ID`, `EXTERNAL_EXPIRED_MESSAGE`, `EXTERNAL_RISKY_MESSAGE`, `isExternalRisky`, `tracksRunState(runId)` (falso para `external`). `sagyou-mcp.ts` e `mcp-external.ts` importam dele; `externalPermissions` mora no `sagyou-mcp.ts`. Os testes de política ficam em `mcp-external.test.ts`.
- **Último aviso:** campo `lastNoticeDay` (`AAAA-MM-DD` local, não é segredo) no próprio `mcp-external.json`; a store ganha `markNoticed(day)`. Acrescenta ao esquema da spec.
- **Log de recusa:** só `expired` e `risky` (revogado é indistinguível de desconhecido sem guardar hashes antigos; só leitura já é "indisponível"). Vale sobre a lista da spec.
- **Timers e atividade:** no `write` do `index.ts`, `runTaskTimers.record` e `recordRunActivity` só rodam se `tracksRunState(session.runId)`; teste de `tracksRunState` na Task 1.
- **Foco 2 no broker:** a Task 2 tem um teste com a store real (temp dir) ligada ao broker: depois de `renew`, o token antigo responde "Sessão MCP inválida ou expirada.". **Foco 4:** teste de que `ler_financeiro` chama `readFinancial` com o `financialProfileId` do token.
- **Porta:** `mcp-external-port` (prod) / `mcp-external-port-dev` (dev); a ponte é um arquivo só, `mcp-external-bridge.cjs`, com fonte idêntico nas duas builds (constante `MCP_EXTERNAL_BRIDGE_SOURCE`). Gravada em `whenReady` (`sagyouMcp.server.listening` ou `once('listening')`), apagada em `before-quit` (best effort). Risco residual documentado: depois de um crash, a ponte pode conectar numa porta reaproveitada e enviar o token a outro processo local.
- **Ícone:** `components/layout/sectionIcons.tsx` ganha `'mcp-externo'`.
- **Guia:** artigo "Acesso MCP externo" no capítulo `sessoes-codigo` de `guide/content.ts`, com `target: { view: 'settings', section: 'mcp-externo' }`.

## Foco de Review

1. **Token vazado.** Status, log, IPC e arquivo nunca contêm o token; o arquivo tem só o hash. Testado nas Tasks 1 e 3.
2. **Token velho vale depois de renovar/revogar.** Renovar troca o hash na hora e o token anterior responde "Sessão MCP inválida ou expirada."; revogar apaga o arquivo. Testado nas Tasks 1 e 2.
3. **Arriscada passa.** Toda ferramenta do conjunto arriscado é recusada pelo token externo **antes** de `deps.write`/`saveMemory`/`createTask` serem chamados, inclusive com o app desbloqueado; sessões do Fleet continuam como hoje. Testado na Task 2.
4. **Escopo.** "Só leitura" não lista nem executa escritas; o projeto padrão e o perfil financeiro do token valem como numa run. Testado na Task 2.
5. **Dados existentes.** Nada muda no SQLite/backup; sem token, o comportamento do broker é idêntico ao de hoje (testes atuais do `sagyou-mcp.test.ts` continuam passando sem alteração). Testado na Task 2.

### Task 1: guardar e conferir o token

**Arquivos:** Criar `apps/desktop/src/main/modules/agent/mcp-external.ts`, `apps/desktop/src/main/__tests__/mcp-external.test.ts`.
**Interfaces:** Produz
`export type McpExternalMode = 'read' | 'read-write'`;
`export interface McpExternalScope { projectId: string | null; financialProfileId: string; mode: McpExternalMode }`;
`export interface McpExternalStatus { state: 'none' | 'active' | 'expired'; createdAt?: number; expiresAt?: number; lastUsedAt?: number | null; scope?: McpExternalScope }`;
`export function createMcpExternalStore(deps: { file: string; now: () => number }): { status(): McpExternalStatus; create(scope): { token: string; status: McpExternalStatus }; renew(): { token: string; status: McpExternalStatus } | null; revoke(): void; verify(token: string): { ok: true; scope: McpExternalScope } | { ok: false; reason: 'invalid' | 'expired' }; touch(): void }`;
`export const EXTERNAL_RUN_ID`, `EXTERNAL_TOKEN_TTL_MS`, `MCP_EXTERNAL_FILE`, `MCP_EXTERNAL_FILE_DEV`, `EXTERNAL_EXPIRED_MESSAGE`, `EXTERNAL_RISKY_MESSAGE`;
`export function externalPermissions(mode): McpPermission[]`; `export function isExternalRisky(name: string): boolean`;
`export function expiryNotice(now: number, expiresAt: number, lastNoticeDay: string | null): { text: string; day: string } | null`;
`export function externalMcpCommand(token: string, execPath: string, bridgePath: string, portFile: string): string`.
- [ ] Passo 1: testes (temp dir real): `create` grava só hash (o JSON não contém o token) com modo 0600 em POSIX; `verify` do token certo → ok com o escopo; errado → invalid; após 30 dias → expired; `renew` → token antigo invalid, novo ok, mesmo escopo, `expiresAt` = agora + 30 d; `revoke` apaga; arquivo ilegível → `status().state === 'none'` e `verify` invalid; `touch` grava `lastUsedAt` e não regrava antes de 60 s; `externalPermissions('read')` sem nenhuma de `WRITE_TOOL_NAMES`, `('read-write')` = todas; `isExternalRisky` verdadeiro para todo `MCP_APPROVAL_REQUIRED` + `save_memory` + `criar_task` e falso para `update_task`; `expiryNotice` null com 4 dias, texto "O acesso MCP externo vence em 3 dias. Renove em Configurações → Acesso MCP externo." com 3, null se já avisou no mesmo dia, "vence hoje" com < 1 dia; `externalMcpCommand` igual à string da restrição.
- [ ] Passo 2: implementar (fs síncrono, `writeFileSync(tmp, …, { mode: 0o600 })` + `renameSync`).
- [ ] Passo 3: commit `feat(mcp-externo): token externo com hash, validade e escopo`.

### Task 2: broker aceita o token externo e recusa as arriscadas

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/sagyou-mcp.ts`. Teste `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`.
**Interfaces:** Consome Task 1. Produz em `McpBrokerDeps`: `externalSession?: (token: string) => McpSession | 'expired' | null`, `onExternalUse?: () => void`; `export const MCP_EXTERNAL_BRIDGE_SOURCE` (ponte que lê `SAGYOU_MCP_PORT_FILE` a cada conexão e injeta `SAGYOU_MCP_TOKEN`).
- [ ] Passo 1: testes sobre um broker real (socket): token externo válido lista as ferramentas do escopo; `tools/call` de leitura funciona com `projectId` padrão do token; `delete_task`/`create_transaction`/`save_memory`/`criar_task` respondem a mensagem arriscada e `deps.write`/`saveMemory`/`createTask` não são chamados; `update_task` chega a `deps.write` com `session.runId === 'external'`; vencido → mensagem de vencido; `null` → "Sessão MCP inválida ou expirada."; sessão de run do Fleet com `delete_task` continua indo a `deps.write`; `onExternalUse` chamado por chamada autorizada; o fonte da ponte não contém token e lê `SAGYOU_MCP_PORT_FILE`.
- [ ] Passo 2: implementar: run sessions primeiro (como hoje); se não achou, `externalSession`; arriscada recusada logo depois da checagem de permissão e de bloqueio.
- [ ] Passo 3: commit `feat(mcp-externo): broker aceita o token externo e recusa escritas arriscadas`.

### Task 3: main — arquivos, IPC, aviso e apagar à distância

**Arquivos:** Criar `apps/desktop/src/main/handlers/mcp-external.ts`. Modificar `apps/desktop/src/main/index.ts` (store, `externalSession`, `isMcpRunLive`, porta, ponte, timers, registro dos handlers depois de `protectDataIpc`, aviso a cada 12 h com `Notification`), `apps/desktop/src/main/modules/sync/wipe.ts`, `apps/desktop/src/preload/index.ts`. Testes `apps/desktop/src/main/__tests__/mcp-external-handlers.test.ts`, `wipe` (teste existente de `wipeTargets`).
**Interfaces:** `registerMcpExternalHandlers(ipcMain, deps: { store; execPath: string; bridgePath: string; portFile: string; writeBridge(): void; log })`; preload `window.electronAPI.mcpExternal.{status, create, renew, revoke}`.
- [ ] Passo 1: testes: `create` grava a ponte, devolve `{ token, command, status }` e loga `external_token_created` sem token; `status` não tem `token` nem `hash` (varre o JSON); `renew` sem token → `{ ok: false, error: 'Nenhum acesso externo para renovar.' }`; `revoke` loga `external_token_revoked`; `wipeTargets(false)` e `(true)` incluem o json certo.
- [ ] Passo 2: implementar; a porta é gravada depois de o broker escutar (`server.once('listening')`).
- [ ] Passo 3: commit `feat(mcp-externo): IPC, ponte, porta e aviso de vencimento`.

### Task 4: tela "Acesso MCP externo"

**Arquivos:** Criar `apps/desktop/src/renderer/src/components/settings/McpExternalSettings.tsx`, `apps/desktop/src/renderer/src/__tests__/components/McpExternalSettings.test.tsx`. Modificar `navigation.ts` (`'mcp-externo'`), `components/views/SettingsView.tsx` (seção entre Sincronização e Sistema).
- [ ] Passo 1: testes: sem token mostra "Nenhum acesso externo." e o formulário (padrões: perfil ativo, "Só leitura"); Gerar chama `create` com o escopo e mostra o comando, "Copiar comando" (clipboard) e o aviso de uma vez só; Pronto esconde o token; ativo mostra "Válido até", "Nunca usado"/último uso e o escopo; vencido mostra "Vencido em"; Revogar pede confirmação com o texto da spec e chama `revoke`; Renovar mostra o novo comando.
- [ ] Passo 2: implementar no padrão do `SyncSettings.tsx`/UI_DESIGN.md.
- [ ] Passo 3: commit `feat(mcp-externo): tela Acesso MCP externo`.

### Task 5: versão, docs, revisão de segurança e PR

- [ ] Passo 1: desktop 1.4.0 (`package.json` + lock); `CLAUDE.md` (exceção à regra de credencial, arquivos novos na tabela de `userData`, canais IPC), `GUIDE.md`, `README.md` (como ligar o Claude Code pelo comando) e artigo no Como funciona (`guide/content.ts`, capítulo Sessões de código).
- [ ] Passo 2: push, PR, CI verde; `/sagyou-review` com **`sagyou-security-reviewer` obrigatório**.
- [ ] Passo 3: teste manual (Luis): Claude Code com Remote Control no Windows lendo e criando tarefas pelo token; escrita arriscada recusada; token vencido e revogado recusados.
