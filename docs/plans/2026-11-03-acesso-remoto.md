# Plano de implementação: Acesso remoto (parear pelo celular + MCP externo total)

Status: approved by Luis on 2026-11-03
Spec: docs/specs/2026-11-03-acesso-remoto.md
Branch: feature/acesso-remoto

**Objetivo:** gerar convite de pareamento no celular e tornar o token MCP externo
permanente, total e (opcionalmente) utilizável com o Sagyou bloqueado.

**Arquitetura:** a parte do celular é só UI sobre `engine.createInvite()` (core e
Worker não mudam). A parte do desktop simplifica `mcp-external.ts` (sem prazo e
sem escopo), troca o perfil financeiro fixo do token por `null` = todos os
perfis, tira o token externo de todo cartão de aprovação e abre uma exceção
estreita do bloqueio: leituras sempre, e escritas com um `store:save` aceito só
durante um `apply` do token externo que o próprio main pediu.

## Restrições Globais

- Sessões do Fleet **não mudam**: perfil capturado, cartões de `MCP_APPROVAL_REQUIRED`, recusa com o app bloqueado, `--disallowedTools mcp__sagyou-externo`.
- Mensagem de token desconhecido/revogado continua "Sessão MCP inválida ou expirada.".
- Mensagem de bloqueio continua "O Sagyou está bloqueado. Desbloqueie no PC para continuar." (`MCP_LOCKED_MESSAGE`).
- Mensagem nova (escrita externa bloqueada com store não carregado): "O Sagyou abriu bloqueado: as escritas voltam depois do primeiro desbloqueio no PC. Leituras funcionam."
- Arquivo: `mcp-external.json` = `{ hash, createdAt, lastUsedAt, allowWhileLocked }`; campos antigos (`expiresAt`, `projectId`, `financialProfileId`, `mode`, `lastNoticeDay`) aceitos na leitura e ignorados.
- Nada novo no SQLite, backup ou sync. Wipe continua apagando `mcp-external.json`.
- Log: nunca token, hash, nome de ferramenta em evento novo, argumentos ou o código de pareamento.
- Convite: vale 10 min e uma vez (Worker, `INVITE_TTL_MS`); o código nunca vai a SQLite, prefs, log ou estado global do celular.
- Testes e2e não rodam localmente (CI). Unitários: `npm test -w sagyou -- <arquivo>` e `npm test -w @sagyou/mobile -- <arquivo>`.

## Foco de Review

1. **Token já existente no formato antigo** (com `expiresAt` vencido, `mode: 'read'`, um `financialProfileId`): deve verificar como válido, com acesso total, sem prazo; a primeira gravação reescreve no formato novo. Testado na Task 1.
2. **Exceção do `store:save` bloqueado**: só passa enquanto há um `apply` externo pendente que o main mandou, vindo do renderer confiável; fora dessa janela todo save bloqueado continua recusado, e o contador volta a zero em erro/timeout. Dentro da janela o save aceito é o estado inteiro em memória (o bloqueio já salvou antes e ninguém edita a tela bloqueada, então ele é o estado do bloqueio + mudanças remotas recebidas + o apply) — aceito de propósito, sem amarrar ao `requestId` (decisão do construtor). O flush usa só `store:save` (`ElectronStorage.save` l.50). Testado na Task 6.
3. **App aberto bloqueado sem nunca desbloquear**: escrita externa recusada com a mensagem nova, nada é gravado (nunca um estado vazio por cima do banco); leituras funcionam. Testado nas Tasks 6 e 7.
4. **Finanças em todos os perfis**: vínculos (espelho de fatura, transferência entre moedas) continuam só dentro do mesmo perfil; o perfil de uma escrita por `tableId` é o da tabela; o Fleet continua confinado ao perfil capturado. Testado na Task 4.
5. **Opção desligada = comportamento de hoje** para o token externo bloqueado (recusa e fila rejeitada ao bloquear); durante `isLocking()` sempre recusa. Testado na Task 6.
6. **Código de pareamento**: some ao fechar a tela e quando `useLockState.hidden` liga; botão desabilitado em `readOnly`. Testado na Task 11.

---

## Parte 2 e 3 — Desktop: token MCP externo

### Task 1: Token permanente no `mcp-external.ts`

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external.ts` · Teste `apps/desktop/src/main/__tests__/mcp-external.test.ts`
**Interfaces:** Produz
```ts
export interface McpExternalStatus { state: 'none' | 'active'; createdAt?: number; lastUsedAt?: number | null; allowWhileLocked?: boolean }
export type McpExternalVerify = { ok: true } | { ok: false; reason: 'invalid' }
export interface McpExternalStore {
  status(): McpExternalStatus
  create(): { token: string; status: McpExternalStatus }   // mantém allowWhileLocked do arquivo atual
  revoke(): void
  verify(token: string): McpExternalVerify
  touch(): void
  allowWhileLocked(): boolean
  setAllowWhileLocked(value: boolean): McpExternalStatus     // sem token: no-op, devolve status
}
```
Remove `EXTERNAL_TOKEN_TTL_MS`, `EXPIRY_NOTICE_DAYS`, `expiryNotice`, `McpExternalMode`, `McpExternalScope`, `renew`, `expiresAt`, `lastNoticeDay`, `markNoticed`.
- [ ] Passo 1: testes que falham: `create()` sobre arquivo antigo grava só os quatro campos novos; `verify` de arquivo antigo `{hash, createdAt, expiresAt: <passado>, projectId:'p', financialProfileId:'personal', mode:'read'}` → `{ ok: true }`; `status()` desse arquivo → `{ state:'active', createdAt, lastUsedAt:null, allowWhileLocked:false }`; `touch()` reescreve o arquivo só com `hash, createdAt, lastUsedAt, allowWhileLocked`; `create()` com arquivo existente `allowWhileLocked:true` mantém `true` e muda o hash (token antigo → `invalid`); `setAllowWhileLocked(true)` grava e `allowWhileLocked()` lê `true`; sem arquivo, `setAllowWhileLocked` não cria arquivo; JSON malformado → `none`; `revoke` → `none`.
- [ ] Passo 2: `npm test -w sagyou -- src/main/__tests__/mcp-external.test.ts`. Esperado: FALHA (verify devolve `expired`, não existe `setAllowWhileLocked`).
- [ ] Passo 3: `parse` exige só `hash` (64 hex) e `createdAt` número; `allowWhileLocked === true` senão `false`; `write` grava só os quatro campos.
- [ ] Passo 4: rode de novo. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): token sem prazo e sem escopo`

### Task 2: IPC `mcp-external:*` e fim do aviso de vencimento

**Arquivos:** Modificar `apps/desktop/src/main/handlers/mcp-external.ts`, `apps/desktop/src/main/index.ts` (bloco `registerMcpExternalHandlers` ~l.1669 e `noticeExpiry` ~l.1683), `apps/desktop/src/preload/index.ts` · Teste `apps/desktop/src/main/__tests__/mcp-external-handlers.test.ts`
**Interfaces:** Consome Task 1. Produz canais `mcp-external:status` (igual), `mcp-external:create` (sem argumento → `McpExternalIssued`), `mcp-external:set-allow-locked` (`(value: boolean) => McpExternalStatus`, recusa não-booleano com o status atual), `mcp-external:revoke` (igual). **`mcp-external:renew` deixa de existir.**
- [ ] Passo 1: testes: `create` sem payload devolve `{ ok:true, token, command, status }` e chama `onTokenChanged`; log `external_token_created` sem `mode`; `set-allow-locked` com `'sim'` não muda nada; com `true` grava e loga `external_allow_locked` `{ value: true }`; `renew` não está registrado.
- [ ] Passo 2: rode o teste. Esperado: FALHA.
- [ ] Passo 3: implemente; remova `noticeExpiry`, o `setInterval` e o import de `expiryNotice` em `index.ts`; atualize os métodos em `preload/index.ts` (`mcpExternal.create()`, `setAllowLocked(value)`, sem `renew`).
- [ ] Passo 4: rode o teste + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): IPC sem escopo e sem vencimento`

### Task 3: Broker: todas as ferramentas, nenhuma recusa de "arriscada" ou "vencido"

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external-policy.ts`, `apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (l.15-18, 54-76, 674-741), `apps/desktop/src/main/index.ts` (`externalSession` l.268) · Teste `apps/desktop/src/main/__tests__/mcp-external-broker.test.ts`, `sagyou-mcp.test.ts`
**Interfaces:** Produz `McpSession.financialProfileId: string | null` (só o externo usa `null`); `externalSession?: (token) => McpSession | null` (sem `'expired'`); `onExternalRefused` passa a ser chamado com `'revoked'` quando um token chega ao broker, `externalSession` devolve `null` **e** não há token ativo (`status().state === 'none'`) — é o único motivo que sobra; remove `externalPermissions`, `EXTERNAL_EXPIRED_MESSAGE`, `EXTERNAL_RISKY_MESSAGE`, `isExternalRisky`, `LEGACY_CARD_WRITES`. Sessão externa: `{ runId: EXTERNAL_RUN_ID, projectId: null, financialProfileId: null, permissions: CODE_EXECUTOR_MCP_PERMISSIONS }`.
- [ ] Passo 1: testes: `tools/list` externo lista exatamente as mesmas ferramentas de `CODE_EXECUTOR_MCP_PERMISSIONS`; `delete_task`, `create_transaction`, `archive_project`, `save_memory` externos chegam a `deps.write`/`deps.saveMemory` (não recebem a mensagem de aprovação); `onExternalRefused` nunca recebe `risky`/`expired`; token desconhecido → "Sessão MCP inválida ou expirada.".
- [ ] Passo 2: rode os dois testes. Esperado: FALHA.
- [ ] Passo 3: implemente; ajuste as descrições `create_financial_profile` ("A sessão continua escrevendo só no perfil atual.") para não mentir à sessão externa: "Cria um perfil financeiro." (decisão do construtor).
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): acesso a todas as ferramentas`

### Task 4: Finanças em todos os perfis para o token externo

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-write-types.ts` e `apps/desktop/src/renderer/src/types/mcp-actions.ts` (`McpScope.financialProfileId: string | null`), `apps/desktop/src/main/modules/agent/mcp-write-tools.ts` (schemas l.289-319), `apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (`read_financial_data`, `ler_financeiro` l.326 e l.913), `apps/desktop/src/main/index.ts` (`readScopedData` 'financial' l.305, `readFinancial` l.337), `apps/desktop/src/renderer/src/services/mcpActions.ts` (`sessionProfile` l.774, `resolveTable` l.781, `saveBankSuggestions` l.843, handlers l.1040-1087) · Teste `apps/desktop/src/renderer/src/__tests__/services/mcpActions.test.ts`, `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`
**Interfaces:** Consome `McpSession.financialProfileId` da Task 3. Produz:
- `readFinancial(profileId: string | null, filter?: string)` e `readScopedData` com perfil `null` → todas as tabelas, cada linha com `profileId` e `profileName`; `filter` = arg opcional `profileId` (só respeitado quando a sessão é `null`; numa run do Fleet é ignorado).
- Schemas: `profileId` opcional (texto, "ID do perfil financeiro; sem ele, o perfil ativo no PC.") em `read_financial_data`, `ler_financeiro`, `create_financial_table`, `add_financial_category`, `remove_financial_category`, `rename_financial_profile`.
- Renderer: `resolveTable` com `scope.financialProfileId === null` aceita tabela de qualquer perfil; `sessionProfile(scope, store, args)` com `null` usa `args.profileId` ou `store.activeFinancialProfileId`, perfil inexistente → "Perfil financeiro não encontrado."; `saveBankSuggestions` usa `table.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID`.
- [ ] Passo 1: testes: escopo `null` cria transação numa tabela do perfil `trabalho`; `create_financial_table` com `profileId:'trabalho'` cria nele; sem `profileId` cria no perfil ativo; `profileId:'x'` → "Perfil financeiro não encontrado."; vínculo de fatura/transferência entre tabelas de perfis diferentes continua recusado; escopo `'personal'` (Fleet) ainda responde `TABLE_REFUSAL` para tabela de outro perfil e ignora `args.profileId`; `read_financial_data` externo devolve tabelas dos dois perfis com `profileName`.
- [ ] Passo 2: rode os dois testes. Esperado: FALHA.
- [ ] Passo 3: implemente. Rode também `src/main/__tests__/mcp-write-tools.test.ts` (schemas, l.39-41/97) e o caso de `MCP_RENDERER_WRITE_TOOLS` em `mcpActions.test.ts` (~l.1229), que comparam as listas main×renderer. Sem `profileId` no externo, `rename_financial_profile` usa o perfil ativo no PC (como os outros); `create_financial_profile` não muda.
- [ ] Passo 4: rode + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): finanças de todos os perfis`

### Task 5: Token externo nunca pede cartão

**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-external-policy.ts` (`externalSkipsCard(runId, name)` → `runId === EXTERNAL_RUN_ID`), `apps/desktop/src/main/index.ts` (`saveMemory` l.369, `write` l.431 e l.447: `approval: externalSkipsCard(...) ? false : MCP_APPROVAL_REQUIRED.has(name)`) · Teste `apps/desktop/src/main/__tests__/mcp-external-broker.test.ts` (ou `mcp-write-queue.test.ts` se a decisão de `approval` for extraída)
**Interfaces:** Produz `externalApproval(runId: string, name: string): boolean` em `mcp-external-policy.ts` (`false` para externo, senão `MCP_APPROVAL_REQUIRED.has(name)`; `save_memory`/`criar_task` → `true` só no Fleet). Os três `enqueue` de `index.ts` usam essa função.
- [ ] Passo 1: teste puro de `externalApproval`: externo + `delete_project` → `false`; externo + `save_memory` → `false`; run `abc` + `delete_project` → `true`; run `abc` + `update_task` → `false`; run `abc` + `save_memory` → `true`.
- [ ] Passo 2: rode. Esperado: FALHA (função não existe).
- [ ] Passo 3: implemente e use nos três `enqueue`.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): escritas sem cartão`

### Task 6: Main — "Funcionar com o Sagyou bloqueado"

**Arquivos:** Criar `apps/desktop/src/main/modules/agent/mcp-external-lock.ts` · Modificar `apps/desktop/src/main/index.ts` (`isMcpRunLive` l.658, `refuseRunWritesForLock` l.1034, `protectDataIpc` l.249, `rendererMcpActions` l.605, `write` l.445), `apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (`isLocked` l.118/728 vira `isLocked?: (runId: string) => boolean`) · Teste criar `apps/desktop/src/main/__tests__/mcp-external-lock.test.ts`, ajustar `mcp-external-broker.test.ts`
**Interfaces:** Produz em `mcp-external-lock.ts`:
```ts
export function externalBlockedByLock(s: { locked: boolean; locking: boolean; allowWhileLocked: boolean }): boolean
// true se locking; true se locked && !allowWhileLocked; senão false
export function createLockedSaveGate(): {
  begin(): () => void          // chamado ao mandar um apply externo bloqueado; devolve end() idempotente
  allows(channel: string): boolean  // true só para 'store:save' com ao menos um begin() aberto
}
```
- **Duas perguntas separadas** (o broker chama `isRunLive` antes de tudo, `sagyou-mcp.ts` l.683, e responderia "Sessão inválida" a um externo bloqueado):
  - `isMcpRunLive(EXTERNAL)` (broker, `isRunLive`) = **só** "token ativo". Bloqueio não entra aqui.
  - Broker `isLocked(runId)` (l.728, dentro de `tools/call`): externo → `externalBlockedByLock(...)`; Fleet → `isAppLocked()` de hoje. `initialize`/`tools/list` bloqueados respondem normalmente (não carregam dados).
  - Fila: `new McpWriteQueue(..., isMcpWriteLive, ...)` com `isMcpWriteLive(runId)` = externo → token ativo && `!externalBlockedByLock(...)`; Fleet → `isMcpRunLive(runId)`. É quem recusa, na hora de executar, uma escrita externa que ficou bloqueada sem a opção. `requestMcpWriteApproval` continua usando `isAppLocked()` (o externo nunca chega lá, Task 5).
- `refuseRunWritesForLock` só rejeita a fila externa se `!mcpExternal.allowWhileLocked()`. Ela é o único ponto: `onAppLocked` e o `prepare` do `appLock` a chamam para todo motivo (inatividade, Windows, suspensão, bandeja), então nenhum outro caminho precisa mudar.
- Apply externo com store não carregado: entra em `begin()` normalmente; o renderer recusa sem salvar (Task 7) e o `finally` fecha a janela.
- `write` externo com app bloqueado: payload `{ phase, name, args, scope, lockedExternal: true }`; antes do `apply` chama `gate.begin()` e o `end()` vai no `finally` (resposta, erro ou timeout do bridge).
- `protectDataIpc`: `assertUnlockedDataAccess` aceita quando `gate.allows(channel)` (o `assertTrustedRenderer` continua obrigatório).
- Log: `mcp`/`external_locked_call` `{ kind: 'read' | 'write' }` a cada chamada externa atendida com o app bloqueado.
- [ ] Passo 1: testes: `externalBlockedByLock` nos 5 casos (desbloqueado; bloqueado sem opção → true; bloqueado com opção → false; locking com opção → true; locking sem opção → true); gate: sem `begin` `allows('store:save')` false; com begin true; `allows('backup:export')` false mesmo com begin; dois begins e um end → ainda true; `end` chamado duas vezes não fica negativo. Broker: externo bloqueado com opção lê `list_projects`; sem opção recebe `MCP_LOCKED_MESSAGE`; run do Fleet bloqueada recebe `MCP_LOCKED_MESSAGE` com a opção ligada; o externo bloqueado sem a opção recebe `MCP_LOCKED_MESSAGE` e **não** "Sessão MCP inválida ou expirada." (broker com `isRunLive` → true e `isLocked(runId)` injetado). Fila (`mcp-write-queue.test.ts`): com `isLive` false na hora de executar, a escrita é rejeitada.
- [ ] Passo 2: rode os testes. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode + typecheck. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): funcionar com o Sagyou bloqueado (main)`

### Task 7: Renderer — aplicar escrita externa com a tela bloqueada

**Arquivos:** Modificar `apps/desktop/src/renderer/src/types/mcp-actions.ts` e `apps/desktop/src/main/modules/agent/mcp-write-types.ts` (`lockedExternal?: boolean` em `McpActionRequest`), `apps/desktop/src/renderer/src/services/mcpActions.ts` (l.1129-1140) · Teste `apps/desktop/src/renderer/src/__tests__/services/mcpActions.test.ts`
**Interfaces:** Consome `lockedExternal` da Task 6.
- [ ] Passo 1: testes: `isDataLocked()` true + `lockedExternal` + `isLoaded` → `create_task` aplica e `storage.save` é chamado (flush); `isDataLocked()` true sem `lockedExternal` → mensagem de bloqueio de hoje e nada salvo; `lockedExternal` + `!isLoaded` → "O Sagyou abriu bloqueado: as escritas voltam depois do primeiro desbloqueio no PC. Leituras funcionam." e `storage.save` não chamado.
- [ ] Passo 2: rode. Esperado: FALHA.
- [ ] Passo 3: a checagem de `isLoaded` vem antes e troca a mensagem quando `lockedExternal`; a de `isDataLocked()` é pulada quando `lockedExternal`. `applyRemoteChanges` e `CloseLifecycle` não mudam.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): escrita com a tela bloqueada`

### Task 8: Tela Configurações → Acesso MCP externo

**Arquivos:** Modificar `apps/desktop/src/renderer/src/components/settings/McpExternalSettings.tsx` · Teste `apps/desktop/src/renderer/src/__tests__/components/McpExternalSettings.test.tsx`
**Interfaces:** Consome IPC da Task 2 e `security:status` (tem senha?).
- [ ] Passo 1: testes com os textos exatos da spec: sem token mostra "Nenhum acesso externo.", o aviso "O token dá leitura e escrita de tudo no Sagyou, inclusive excluir e mexer em dinheiro, sem pedir aprovação. Não vence: vale até você revogar." e **Gerar acesso** (sem selects de projeto/perfil/acesso); ativo mostra "Ativo desde …", "Último uso: …"/"Nunca usado", "Acesso total, sem prazo", **Gerar novo token** e **Revogar**; Gerar novo token pede "Gerar um token novo? O atual para de valer na hora e o comando do Claude Code precisa ser trocado." antes de chamar `create`; interruptor "Funcionar com o Sagyou bloqueado" só aparece com senha, com o texto de aviso da spec, e chama `setAllowLocked(true)`.
- [ ] Passo 2: rode. Esperado: FALHA.
- [ ] Passo 3: implemente seguindo `UI_DESIGN.md` (rode a skill `sagyou-ui`).
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp-externo): tela sem prazo, com acesso total`

### Task 9: Guia "Como funciona" — Acesso MCP externo

**Arquivos:** Modificar `apps/desktop/src/renderer/src/guide/content.ts` (~l.460-485) · Teste `apps/desktop/src/renderer/src/__tests__/guide/content.test.ts`
- [ ] Passo 1: teste: o artigo do MCP externo não contém "30 dias", "Renovar", "Só leitura" nem "vencer"; contém "não vence" e "Funcionar com o Sagyou bloqueado".
- [ ] Passo 2: rode. Esperado: FALHA.
- [ ] Passo 3: reescreva o artigo: acesso total sem prazo, Gerar novo token/Revogar, a opção bloqueado com o risco (senha do Windows), e o lembrete de desligar suspensão/bloqueio por inatividade para uso remoto.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `docs(guia): acesso MCP externo total e sem prazo`

---

## Parte 1 — Celular: parear outro aparelho

### Task 10: Componente `QrCode` e dependências

**Arquivos:** Modificar `apps/mobile/package.json` (+ `qrcode`, `@types/qrcode` dev, `expo-clipboard` via `npx expo install expo-clipboard`) · Criar `apps/mobile/src/components/QrCode.tsx`, reexportar em `ui.tsx` · Teste criar `apps/mobile/src/components/__tests__/QrCode.test.tsx`; mock de `expo-clipboard` no setup do Jest
**Interfaces:** Produz `QrCode({ value: string; size: number; accessibilityLabel: string })` — `QRCode.create(value, { errorCorrectionLevel: 'M' })`, um `Rect` por módulo escuro em `react-native-svg`, margem de 4 módulos, fundo **sempre branco e módulos pretos** nos dois temas (leitores de QR falham invertido; decisão do construtor).
- [ ] Passo 1: teste: renderiza `Svg` com `accessibilityLabel`; o número de `Rect` escuros é igual ao de módulos `true` de `QRCode.create(value).modules`; mesmo valor → mesma saída.
- [ ] Passo 2: `npm test -w @sagyou/mobile -- src/components/__tests__/QrCode.test.tsx`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): componente QrCode`

### Task 11: Tela `ParearAparelho` e linha em Ajustes

**Arquivos:** Criar `apps/mobile/src/screens/PairDeviceScreen.tsx` · Modificar `apps/mobile/src/App.tsx` (root stack: `ParearAparelho: undefined`, `<Stack.Screen name="ParearAparelho" … title "Parear outro aparelho">`), `apps/mobile/src/screens/SettingsScreen.tsx` (linha abaixo de "Como funciona"; `navigate` aceita `'ParearAparelho'`) · Teste criar `apps/mobile/src/screens/__tests__/PairDeviceScreen.test.tsx`, ajustar `SettingsScreen.test.tsx`, `a11y.test.tsx`
**Interfaces:** Consome `useApp((s) => s.services?.runtime.engine)` (como `ConflictsScreen.tsx` l.69) → `createInvite(): Promise<{ code: string; expiresAt: number }>`, `useLockState` (`src/lock/lockState.ts`, `{ hidden }`), `useUndo().show` (`src/store/undo.ts`), `QrCode` (Task 10), `Clipboard.setStringAsync`.
- A linha "Parear outro aparelho" **não aparece** com `readOnly` ou sem engine, como a linha de conflitos (`ListItem` não tem `disabled`; decisão do construtor).
- Erros: `createInvite` converte tudo em `SyncUserError` (`engine.ts` l.1144-1157, offline vira "Sem conexão com o servidor de sincronização."), então a tela mostra **sempre** `error.message` + **Tentar de novo**; outro tipo de erro (não esperado) mostra "Não foi possível gerar o código." (decisão do construtor; substitui o texto de rede da spec).
- Estado local só no componente: `{ code, expiresAt } | 'loading' | { error: string } | 'expired'`. Contagem `M:SS` por `setInterval` de 1 s. `useLockState.hidden` → `navigation.goBack()` e zera o código. Desmontar zera o código.
- Textos exatos: "Escaneie no outro aparelho, ou cole o código em Configurações → Sincronização → Entrar com código."; "Vale uma vez só e expira em M:SS"; botão **Copiar código** → snackbar "Código copiado."; "O código expirou." + **Gerar outro**.
- [ ] Passo 1: testes (timers falsos): abre → `createInvite` chamado uma vez, QR com label "Código de pareamento", "expira em 10:00"; avançar 1 s → "9:59"; avançar até `expiresAt` → "O código expirou." e **Gerar outro** chama `createInvite` de novo; Copiar código chama `Clipboard.setStringAsync(code)` e mostra "Código copiado."; `SyncUserError('Sem conexão com o servidor de sincronização.')` → esse texto + Tentar de novo (chama `createInvite` de novo); `new Error('x')` → "Não foi possível gerar o código."; `hidden` true → `goBack`; Ajustes: linha "Parear outro aparelho" ausente com `readOnly`, presente e navegando para `ParearAparelho` sem; nenhum `console.log`/pref recebe o código (espiar `repo.setPref`).
- [ ] Passo 2: rode os testes. Esperado: FALHA.
- [ ] Passo 3: implemente com os componentes do design system (`Screen`, `Button`, `Skeleton`, `Card`), alvos 48 dp.
- [ ] Passo 4: rode os testes + `a11y.test.tsx`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): parear outro aparelho pelo celular`

### Task 12: Guia de sincronização

**Arquivos:** Modificar `apps/desktop/src/renderer/src/guide/sync-content.ts` (`sync-parear-pc` l.155, `sync-parear-celular` l.179) · Teste `apps/desktop/src/renderer/src/__tests__/guide/sync-content.test.ts`. `packages/core/src/sync/guide.ts` só muda se `grep -n "PC" packages/core/src/sync/guide.ts` mostrar uma frase dizendo que o convite vem do PC; nesse caso o teste é `packages/core/src/sync/__tests__/guide.test.ts` (criar se não existir) e `apps/mobile/src/screens/__tests__/SyncGuide.test.tsx`.
- [ ] Passo 1: teste: `sync-parear-pc` e `sync-parear-celular` dizem que o código pode vir de "um PC ou do celular (Ajustes → Parear outro aparelho)".
- [ ] Passo 2: rode. Esperado: FALHA.
- [ ] Passo 3: atualize os textos (o guia não pode mentir sobre o app).
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `docs(guia): parear a partir do celular`

---

### Task 13: Fechamento

- [ ] `npm run typecheck`, `npm run lint`, `npm test` (pelo agente `sagyou-test-runner`); e2e só no CI.
- [ ] Verificação no app (`npm run dev`): Configurações → Acesso MCP externo (gerar, novo token, revogar, interruptor); com a opção ligada, "Bloquear agora" e uma chamada `list_projects` + `criar_task` pelo `sagyou-externo` funcionam; sem a opção, recusam. Celular: APK pelo workflow `mobile-apk.yml`, gerar convite e parear o PC de teste.
- [ ] Atualizar `CLAUDE.md` (MCP externo: sem prazo, total, `allowWhileLocked`, gate do `store:save`; IPC `mcp-external:*`; tabela de `userData`; mobile `ParearAparelho`), `GUIDE.md` e `README.md` (seção Acesso MCP externo e pareamento).
- [ ] Versões: desktop minor (`apps/desktop/package.json`), mobile minor (`app.json` + `versionCode`).
- [ ] `/sagyou-review` (com `sagyou-security-reviewer`: IPC, MCP, bloqueio) → `/sagyou-pr`.
