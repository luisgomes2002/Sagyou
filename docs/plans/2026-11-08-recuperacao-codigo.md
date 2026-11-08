# Plano de implementação: Recuperar a sincronização pelo código no PC

Status: approved by Luis on 2026-11-08
Spec: docs/specs/2026-11-08-recuperacao-codigo.md
Branch: feature/recuperacao-codigo

**Objetivo:** o PC recupera a sincronização com o código de recuperação, substituindo os
dados locais pelos da nuvem com backup antes.

**Arquitetura:** `engine.recover` (core) ganha `mode` com a mesma mecânica do `join` em
`'replace'` (backup antes do Worker, pausa `'join'` até `takeCloud`). O handler
`sync:recover` do main passa sempre `'replace'`; o preload não muda. A seção nova vive em
`SyncSettings.tsx`. Os guias (desktop e core) param de dizer que a tela não existe.

## Restrições Globais

- Título da seção: `Perdi todos os aparelhos`. Texto: `Use quando nenhum aparelho pareado está à mão. Os dados deste PC serão substituídos pelos da nuvem (um backup é feito antes).`
- Rótulos: `Código de recuperação`, `Senha de configuração do Worker`, `Código do autenticador ou reserva`. Botão `Recuperar` (desligado sem os três).
- Confirmação: `Os dados deste PC serão substituídos pelos da nuvem. Um backup deste PC é feito antes.` com `Recuperar e substituir` / `Cancelar`.
- Toast de sucesso: `Sincronização recuperada. Revogue os aparelhos perdidos em Aparelhos.`
- Backup falhou: `Não foi possível fazer o backup antes de substituir. Nada foi alterado.` (texto que o `join` já usa).
- Segredos só no estado da seção; erro mantém os campos; sucesso/Cancelar da seção limpa. Nunca em log.
- Celular: tela não muda; `recover` sem `mode` continua juntando.
- Testes não rodam localmente (pedido do Luis): verificação pelo CI do PR.
- Versões: desktop 1.7.x → MINOR seguinte; celular 0.4.0 → 0.4.1 (versionCode 401).

## Foco de Review

1. **Backup antes do Worker.** Com `mode: 'replace'` e backup falhando, nenhum `/setup` é
   feito, `config` continua `null` e os dados locais ficam intactos. Testado na Task 1.
2. **Nada local é enviado num replace.** Depois de recuperar com dados locais só no PC, o PC
   fica só com a nuvem e o outro lado não recebe o que era local. Testado na Task 1.
3. **Download falhando deixa a pausa `'join'`**, nunca um ciclo normal que juntaria e
   enviaria os dados locais. Testado na Task 1.
4. **O celular não muda:** `recover` sem `mode` continua juntando (teste existente de
   "pareamento e convergência" continua passando). Testado na Task 1.
5. **Segredos não ficam na tela depois do sucesso (nem depois de uma pausa)**, o toast não
   mente com a sincronização pausada, e o handler chama o motor com `'replace'`. Testado
   nas Tasks 2 e 3.
6. **Backup só depois das guardas:** com a sincronização já ativa (ou sem chaveiro), nada
   de backup. Testado na Task 1.

### Task 1: modo na recuperação (core)

**Arquivos:**
- Modificar `packages/core/src/sync/engine.ts` (interface `recover` ~l.283; implementação ~l.1136; `activateWithKey`)
- Teste `apps/desktop/src/main/__tests__/sync-engine.test.ts` (describe novo `recuperar substituindo`, ao lado de `substituir` ~l.1427)

**Interfaces:** Produz `recover(code, setupToken, deviceName, factor?, mode?: 'merge' | 'replace'): Promise<SyncStatus>`.

- [ ] Passo 1: testes (mesmo setup do describe `substituir`: `a` ativa com `p1`, `b` tem `pb`, recupera com `a.engine.recoveryCode()`, `SETUP`, `{ totp: '123456' }`):
  - `backup que falha impede a recuperação e não chama /setup`: `b.backup.mockResolvedValue(false)` → rejeita com texto contendo `backup`; nenhum request termina em `/setup` depois do de `a`; `b.config.stored` é `null`; `dataHashes(b.store)` igual a antes.
  - `recuperar substituindo fica só com a nuvem`: `b.backup` chamado 1 vez; `b.store.state.projects` = `['p1']`; `b.config.stored?.paused` = `null`; depois de `POLL_MS`, `a` continua só com `['p1']`.
  - `download que falha deixa a pausa 'join'`: `server.failPull = 1` (campo novo do `FakeServer`, ver Passo 3) → `b.engine.status().state` = `'paused'`, `paused` = `'join'`, `b.store.state.projects` continua `['pb']` e nenhum `/push` de `b` foi feito.
  - `recuperar com a sincronização já ativa não faz backup`: `b` já ativo → rejeita com "A sincronização já está ativa neste aparelho." e `b.backup` não foi chamado.
  - O teste existente (~l.810, `recover` sem `mode`) não muda.
- [ ] Passo 2: esperado no CI: FALHA (o 5º argumento é ignorado e a recuperação junta).
- [ ] Passo 3:
  - `FakeServer` (`sync-engine.test.ts` ~l.130): campo `failPull = 0`; enquanto `> 0`, um `/pull` responde 500 e decrementa.
  - `activateWithKey` ganha `opts?: { replace?: boolean }`. Ordem dentro do seu `exclusive`: guardas de hoje (sessão ativa, chaveiro) → **se `replace`**, `if (!(await deps.forcedBackup())) throw new SyncUserError('Não foi possível fazer o backup antes de substituir. Nada foi alterado.')` → `/setup` → `config` salva com `paused: opts?.replace ? 'join' : null` → `session` etc. → **se `replace`**, ainda dentro do `exclusive`: `try { await takeCloud(s); saveConfig(s, { paused: null }) } catch (err) { handleFailure(err) }` (a mesma sequência do `join`, l.~1210-1233). Assim o `schedule(0)` do `.finally` nunca roda um ciclo normal antes do `takeCloud`, e com o download falho a pausa `'join'` segura.
  - `recover(code, setupToken, deviceName, factor, mode)`: `activateWithKey(..., { replace: mode === 'replace' })`; depois, `cycle()` só se a sessão existir e não estiver pausada (como o `join`). `mode` ausente: comportamento de hoje.
- [ ] Passo 4: esperado no CI: PASSA.
- [ ] Passo 5: commit `feat(sync): recuperar substituindo pelos dados da nuvem`

### Task 2: o handler do PC sempre substitui

**Arquivos:**
- Modificar `apps/desktop/src/main/handlers/sync.ts` (~l.76, `sync:recover`)
- Teste novo `apps/desktop/src/main/__tests__/sync-handlers.test.ts` (`@vitest-environment node`)

**Interfaces:** Consome `recover(..., mode)` da Task 1.

- [ ] Passo 1: teste `sync:recover chama o motor com replace`: `registerSyncHandlers` com um `ipcMain` falso que captura `handle`, `engine` falso com `recover: vi.fn().mockResolvedValue(status)`, `defaultDeviceName: () => 'PC'`; invocar `sync:recover` com `('CODE', 'setup', undefined, { totp: '123456' })` → `recover` chamado com `('CODE', 'setup', 'PC', { totp: '123456' }, 'replace')` e resposta `{ ok: true, status }`. Segundo caso: `SyncUserError('Código de recuperação inválido.')` vira `{ ok: false, error: 'Código de recuperação inválido.' }`.
- [ ] Passo 2: esperado no CI: FALHA (sem o 5º argumento).
- [ ] Passo 3: passar `'replace'` como 5º argumento.
- [ ] Passo 4: esperado no CI: PASSA.
- [ ] Passo 5: commit `feat(sync): o PC recupera sempre substituindo`

### Task 3: seção "Perdi todos os aparelhos" (desktop)

**Arquivos:**
- Modificar `apps/desktop/src/renderer/src/components/settings/SyncSettings.tsx` (depois da seção "Outro aparelho já sincroniza", ~l.520-578; mesma condição de exibição das duas)
- Teste `apps/desktop/src/renderer/src/__tests__/components/SyncSettings.test.tsx` (mock `recover` no `window.electronAPI.sync`; describe `Sincronização: recuperar`)

**Interfaces:** Consome `window.electronAPI.sync.recover(code, setupToken, deviceName?, factor?)` (preload sem mudança).

Usar a skill `sagyou-ui` (UI_DESIGN.md). Estado: `recoverCode`, `recoverSetup`, `recoverFactor`, `askRecover` (boolean). Ação `recover()` via `act('Não foi possível recuperar a sincronização.', …)`: chama `recover(code.trim(), setup, deviceName.trim() || undefined, { totp: factor.trim() })`; `!result.ok` → `throw new Error(result.error)` (campos mantidos). `ok`:
- `result.status.state` é `'off'` ou `'disconnected'` (401 no download): `throw new Error('Não foi possível recuperar a sincronização.')`, campos mantidos;
- senão limpa os três e `askRecover`, `setStatus(result.status)`, `await refresh()`; o toast exato só se `state !== 'paused'` (pausado, a faixa com **A nuvem manda** já aparece).
Os segredos persistem ao trocar de seção dentro de Configurações (a Sincronização fica montada escondida, como o código do "Entrar com código") e somem ao sair de Configurações (desmonta); decisão registrada na spec.

- [ ] Passo 1: testes com `withStatus({ state: 'off' })`:
  - a seção aparece com o título e o texto exatos; `Recuperar` desligado até os três campos terem texto;
  - `Recuperar` abre a confirmação com o texto exato e **não** chama `recover`; `Cancelar` fecha e mantém os campos;
  - `Recuperar e substituir` chama `recover('CODE', 'setup', undefined, { totp: '123456' })`; sucesso mostra o toast exato (`onToast`) e os três campos voltam vazios;
  - erro `{ ok: false, error: 'Código de recuperação inválido.' }` mostra o erro (role `alert`) e mantém os campos;
  - resposta `ok` com `status.state: 'paused'` (`paused: 'join'`): campos limpos, **sem** toast;
  - resposta `ok` com `status.state: 'off'`: mostra "Não foi possível recuperar a sincronização." e mantém os campos;
  - com `state: 'ok'` a seção não aparece.
  - Setup: acrescentar `recover: vi.fn().mockResolvedValue({ ok: true, status })` ao mock de `window.electronAPI.sync` (~l.60-102).
- [ ] Passo 2: esperado no CI: FALHA (seção inexistente).
- [ ] Passo 3: implementar no padrão das vizinhas (`Subsection`, `fieldClass`, `primaryClass`/`secondaryClass`, `panelClass` como o "Juntar / Substituir"); código em `<textarea>` mono com `autoComplete="off"` e `spellCheck={false}`; senha `type="password"`.
- [ ] Passo 4: esperado no CI: PASSA.
- [ ] Passo 5: commit `feat(sync): recuperar pelo código no PC`

### Task 4: guias, docs, versões e PR

**Arquivos:**
- `apps/desktop/src/renderer/src/guide/sync-content.ts` (artigo `sync-perdi-todos`): trocar o callout `danger` "Esta versão do app ainda não tem uma tela…" por passos: no PC, Configurações → Sincronização → Perdi todos os aparelhos (código de recuperação, senha de configuração do Worker, código do autenticador ou reserva; substitui os dados do PC, com backup antes); no celular, Entrar com código de recuperação; depois, revogar os aparelhos perdidos. Manter o callout sobre restaurar backup e criar D1 novo **só para quem perdeu também o código**. O `target` do artigo passa de `dados-backup` (~l.284) para a constante `SYNC_SETTINGS` (`sync-content.ts:11`).
- `packages/core/src/sync/guide.ts` (linha "Todos os aparelhos"): `'O código de recuperação: no PC, Configurações → Sincronização → Perdi todos os aparelhos; no celular, Entrar com código de recuperação.'`
- Testes de texto (novos; hoje nenhum cobre o artigo): `apps/desktop/src/renderer/src/__tests__/guide/sync-content.test.ts` (o artigo `sync-perdi-todos` não contém "ainda não tem uma tela", contém "Perdi todos os aparelhos" e "Configurações → Sincronização", e aponta para `SYNC_SETTINGS`) e `packages/core/src/sync/__tests__/guide.test.ts` (a linha "Todos os aparelhos" não contém "ainda não existe" e contém "Perdi todos os aparelhos").
- `CLAUDE.md`: remover o aviso "⚠️ `sync:recover` has no renderer caller yet…" e registrar que o PC recupera sempre em `'replace'` (seção do sync). `GUIDE.md` se citar o mesmo aviso.
- Versões: `apps/desktop/package.json` + `packages["apps/desktop"]` do lock (MINOR seguinte à da `main` no momento do PR); `apps/mobile/app.json` (`expo.version` 0.4.1, `android.versionCode` 401), `apps/mobile/package.json`, `packages["apps/mobile"]` do lock.

- [ ] Passo 1: atualizar guias e testes de texto; commit `docs(guia): recuperar pelo código no PC e no celular`.
- [ ] Passo 2: docs e versões; commit `chore: versões e docs da recuperação pelo código`.
- [ ] Passo 3: push, `/sagyou-review` (com `sagyou-security-reviewer` e `sagyou-ui-reviewer`), PR, `gh pr checks` até verde.
- [ ] Passo 4: verificação no app (com Luis, num PC de teste ou perfil dev com sync desligado): a seção aparece, a confirmação, um código inválido mostra o erro.
