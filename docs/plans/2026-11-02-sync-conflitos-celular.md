# Plano de implementação: Conflitos no celular e envio ao sair do app

Status: approved by Luis on 2026-11-02
Spec: docs/specs/2026-11-02-sync-conflitos-celular.md
Branch: feature/sync-conflitos-celular

**Objetivo:** o celular resolve os próprios conflitos, um conflito fecha sozinho quando o item é
resolvido ou segue adiante em outro aparelho, e o pendente do celular sai ao ir para segundo plano.

**Arquitetura:** a regra de fechamento nasce no resolver do core (`apply.ts`), que passa a devolver
`settled` (versões recebidas mais novas que não geraram conflito); cada armazenamento roda o mesmo
`UPDATE` exportado pelo core. `engine.resolve` passa a reenviar ao manter a versão atual
(`rebaseSyncVersion`) e ganha `engine.flush()` para o segundo plano. O celular ganha a tela
`Conflitos` no stack raiz.

## Restrições Globais

- Sem mudança de dados: nenhuma tabela/coluna; só `sync_conflicts.resolved_at` é gravado. `sync-vectors.json` não muda (nunca regenerar).
- Core sem Node (`no-node.test.ts`): o SQL do fechamento é uma string constante, sem import de banco.
- Fechar sozinho: versão recebida com `hlc` maior que a local e decisão `apply` (com versão local presente) ou `skip` com adoção (mesmo conteúdo, `hlc` maior). Só fecha conflitos com `type <> 'orphan'`, `resolved_at IS NULL`, mesmo `kind`+`record_id`, e `loser_hlc < hlc` e `(winner_hlc IS NULL OR winner_hlc < hlc)`.
- Fechar sozinho nunca chama `notifySaved` (não envia nada).
- Resolver `lww` mantendo a atual: `rebaseSyncVersion(kind, id, <hlc atual>, now)` + `notifySaved()`. `orphan`/Dispensar não envia.
- Textos (celular): "1 conflito" / "N conflitos"; título "Conflitos"; "Versão deste aparelho · <data>"; "Versão de <aparelho> · <data>"; "Usar esta"; "Apagado"; "Removido: o item de origem foi apagado em outro aparelho"; "Dispensar"; snackbar "Versão escolhida." / "Conflito dispensado."; vazio "Nenhum conflito" + "Quando o mesmo item mudar em dois aparelhos, as duas versões aparecem aqui."
- Segundo plano: `engine.flush()` = **primeiro** `started = false; clearTimers()`, depois, se havia sessão ativa, não pausada e não `wiped`, `await cycle().catch(() => undefined)`. Parar antes do `await` (decisão do construtor) faz um `start()` no meio (app voltou) valer: o `finally` do ciclo agenda o próximo porque `started` voltou a ser true, e o `schedule(0)` do `start` cai no `rerun` do ciclo em andamento, sem ciclo paralelo. Erro é engolido (o pendente fica na fila).
- Por que o reenvio do `lww` usa o `hlc` atual (e o `pending_choice` usa `loserHlc`): no `lww` os dois aparelhos convergem para a mesma vencedora W, então o outro tem W como atual; a versão reenviada (base W, mesmo hash, `hlc` novo) cai no teste de mesmo conteúdo de `decideIncoming`, que vem antes do teste de `baseHlc`, e dá `skip` com adoção. No `pending_choice` cada aparelho ficou com o seu lado, por isso a base é o `hlc` do outro (`loserHlc`), como hoje.
- Datas: helper novo `versionTimeText(at: number | null): string` em `packages/core/src/sync/view.ts` (`toLocaleString('pt-BR')` ou "hora desconhecida"); o `ms` já vem pronto em `SyncVersionView.at`. O `formatTime` do `SyncSettings.tsx` passa a usá-lo.
- A tela do celular obtém o engine como o `SettingsScreen`: `useApp((s) => s.services)?.runtime.engine`, `useApp((s) => s.status)` e `useApp((s) => s.readOnly)`.
- Versões: celular `0.1.0` / `versionCode` `100` (app.json, package.json, package-lock); desktop `1.2.2` (package.json, package-lock).
- Testes: Vitest no desktop/core; Jest (`jest-expo`) no celular com `await` em `render`/`fireEvent`. E2E não roda local.

## Foco de Review

1. **Conflito criado e fechado na mesma busca.** Um pull que traz a versão conflitante e, depois, uma versão por cima dela: o conflito novo é gravado e fechado na mesma transação (o `UPDATE` roda depois de `writeConflicts`). Testado na Task 2.
2. **Eco entre aparelhos.** Fechar sozinho não gera versão nova; manter a atual gera exatamente uma. Testado nas Tasks 1 e 3.
3. **Dados existentes.** Conflitos abertos antes da atualização continuam abertos até chegar uma versão que os feche; nenhum conflito `orphan` fecha sozinho. Testado nas Tasks 1 e 2.
4. **Aparelho antigo recebendo o reenvio.** A versão reenviada tem o mesmo conteúdo e `baseHlc` = vencedora: `decideIncoming` dá `skip` com adoção, sem conflito novo. Testado na Task 1 (merge) e Task 3.
5. **Segundo plano sem rede/pausado/desconectado.** `flush` não lança, não roda ciclo quando pausado ou sem sessão, e sempre para os timers. Testado na Task 4.

### Task 1: core — resolver devolve `settled`

**Arquivos:** Modificar `packages/core/src/sync/apply.ts`, `packages/core/src/sync/view.ts` (`versionTimeText`), `apps/desktop/src/renderer/src/components/settings/SyncSettings.tsx` (`formatTime` usa o helper). Teste `apps/desktop/src/main/__tests__/sync-apply.test.ts`, `sync-merge.test.ts`, `sync-view.test.ts` (novo, mesma pasta).
**Interfaces:** Produz `export interface SettledVersion { kind: SyncKind; recordId: string; hlc: string }`; `ApplyPlan.settled: SettledVersion[]`; `MemoryApplyPlan.settled: SettledVersion[]`; `export const CLOSE_SETTLED_CONFLICTS_SQL: string`; `export function settledConflictParams(s: SettledVersion, now: number): [number, string, string, string, string]` (ordem: `now, kind, recordId, hlc, hlc`).
- [ ] Passo 1: testes que falham em `sync-apply.test.ts` (`describe('settled')`): (a) local `hlc` A, recebido B>A com `baseHlc` A e conteúdo diferente → `plan.settled` = `[{kind,recordId,hlc:B}]`; (b) recebido com mesmo conteúdo e `hlc` maior, `baseHlc` ≠ local → `settled` com esse `hlc`; (c) recebido que vira `apply-and-keep-loser` ou `keep-local-and-keep-loser` → `settled` vazio; (d) recebido sem versão local (`apply` de item novo) → vazio; (e) mesmo `hlc` (`skip` puro) → vazio; (f) memória com versão por cima → `planMemoryApply(...).settled` com 1 item. Em `sync-merge.test.ts`: (g) `decideIncoming` com local `{hlc: W, hash: H}` e recebido `{hlc: N>W, baseHlc: W, payload de hash H}` → `{type:'skip'}` (o reenvio do `lww` não vira conflito). Em `sync-view` (teste novo no `sync-records.test.ts` ou arquivo próprio `sync-view.test.ts`): (h) `versionTimeText(null)` = "hora desconhecida".
- [ ] Passo 2: rode `npm test -w sagyou -- src/main/__tests__/sync-apply.test.ts`. Esperado: FALHA porque `settled` não existe.
- [ ] Passo 3: no `createResolver`, `settled.push` no `case 'apply'` quando `local` existe e no ramo de adoção do `case 'skip'`; expor em `planRemoteApply`/`planMemoryApply`. `CLOSE_SETTLED_CONFLICTS_SQL = "UPDATE sync_conflicts SET resolved_at=? WHERE kind=? AND record_id=? AND resolved_at IS NULL AND type <> 'orphan' AND loser_hlc < ? AND (winner_hlc IS NULL OR winner_hlc < ?)"`.
- [ ] Passo 4: rode o mesmo comando + `npm test -w @sagyou/core`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): resolver aponta versões que encerram conflitos`

### Task 2: armazenamentos fecham conflitos assentados

**Arquivos:** Modificar `apps/mobile/src/data/sync-store.ts`, `apps/desktop/src/main/store.ts`. Teste `apps/mobile/src/data/__tests__/sync-store.test.ts`.
**Interfaces:** Consome `ApplyPlan.settled`, `MemoryApplyPlan.settled`, `CLOSE_SETTLED_CONFLICTS_SQL`, `settledConflictParams` (Task 1).
- [ ] Passo 1: testes que falham em `sync-store.test.ts`: (a) aparelho com conflito `lww` aberto de uma tarefa; `applyRemoteRecords` com versão por cima da atual → `openSyncConflictCount` vai de 1 a 0 e `listSyncConflicts` vazio; (b) mesma busca traz a versão conflitante e depois uma por cima dela → 0 abertos; (c) conflito `orphan` aberto + versão nova do mesmo id → continua 1; (d) versão recebida que cria conflito novo → antigo continua aberto (2 abertos); (d2) conflito aberto antigo cujo `loser_hlc` é maior que a versão recebida → continua aberto; (e) memória: mesmo caso de (a) via `applyRemoteRecords` com `kind: 'memory'` → 0.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- src/data/__tests__/sync-store.test.ts`. Esperado: FALHA porque nada marca `resolved_at`.
- [ ] Passo 3: no celular, `closeSettled(settled, now)` roda `db.run(CLOSE_SETTLED_CONFLICTS_SQL, settledConflictParams(s, now))` para cada item, depois de `writeConflicts` em `applyRemoteRecords` e em `applyMemories`. No desktop, `closeSettledConflicts(db, settled, now)` com `db.prepare(CLOSE_SETTLED_CONFLICTS_SQL)` nos mesmos dois pontos (`applyRemoteRecords` e `applyMemoriesIn`), dentro da transação. (SQL do desktop não roda no vitest: mesma string do core, verificado pelo teste do celular e no app.)
- [ ] Passo 4: rode o mesmo comando + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): fechar sozinho conflito resolvido em outro aparelho`

### Task 3: engine — manter a versão atual reenvia

**Arquivos:** Modificar `packages/core/src/sync/engine.ts`. Teste `apps/desktop/src/main/__tests__/sync-engine.test.ts`.
**Interfaces:** Consome `store.syncRecordVersion`, `store.rebaseSyncVersion` (existentes).
- [ ] Passo 1: testes que falham: (a) conflito `lww` cujo guardado é do outro aparelho, `resolve(id, 'local')` → `rebaseSyncVersion` chamado com `(kind, recordId, <hlc atual de syncRecordVersion>, now)`, `markSyncConflictResolved` chamado e um push agendado (debounce de 5 s dispara `cycle`); (b) `orphan` com `resolve(id, 'local')` → `rebaseSyncVersion` não chamado, nenhum push agendado; (c) `pending_choice` mantém o comportamento atual (rebase com `loserHlc`); (d) `lww` sem versão local (`syncRecordVersion` null) → não rebase, conflito marcado resolvido.
- [ ] Passo 2: rode `npm test -w sagyou -- src/main/__tests__/sync-engine.test.ts`. Esperado: FALHA em (a).
- [ ] Passo 3: em `resolve`, quando `!adoptKept && row.type === 'lww'`, ler `store.syncRecordVersion(row.kind, row.recordId)` e, se houver, `rebaseSyncVersion(..., version.hlc, now)`; `notifySaved()` quando reenviou.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): manter a versão atual também avisa os outros aparelhos`

### Task 4: engine `flush()` e envio ao ir para segundo plano

**Arquivos:** Modificar `packages/core/src/sync/engine.ts`, `apps/mobile/src/sync/runtime.ts`. Teste `apps/desktop/src/main/__tests__/sync-engine.test.ts`, `apps/mobile/src/sync/__tests__/runtime.test.ts`.
**Interfaces:** Produz `SyncEngine.flush(): Promise<void>`.
- [ ] Passo 1: testes que falham: engine — (a) com pendente e debounce armado, `flush()` faz um push imediato (fetch `/push` chamado) e depois não há timer ativo; (b) pausado ou sem sessão: nenhum fetch, timers limpos; (c) fetch rejeita (offline): `flush()` resolve sem lançar e timers limpos; runtime — (d) `AppState` → `background` chama `engine.flush()` (não `stop()` direto); (e) `dispose()` chama `flush()`; engine — (f) `flush()` com o fetch pendurado, `start()` no meio, fetch resolve → existe timer de poll agendado e só um ciclo rodou ao mesmo tempo.
- [ ] Passo 2: rode `npm test -w sagyou -- src/main/__tests__/sync-engine.test.ts` e `npm test -w @sagyou/mobile -- src/sync/__tests__/runtime.test.ts`. Esperado: FALHA (`flush` não existe).
- [ ] Passo 3: `flush` limpa o debounce; se `started && session && !paused && !wiped` faz `await cycle().catch(() => undefined)`; por fim `started = false; clearTimers()` (o `finally` do `cycle` agenda via `schedule`, que já não agenda com `started` falso). Runtime: `else if (state === 'background') void engine.flush()`; `dispose` idem.
- [ ] Passo 4: rode os mesmos comandos. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): enviar o pendente ao ir para segundo plano`

### Task 5: celular — tela Conflitos e linha em Ajustes

**Arquivos:** Criar `apps/mobile/src/screens/ConflictsScreen.tsx`, `apps/mobile/src/screens/__tests__/ConflictsScreen.test.tsx`. Modificar `apps/mobile/src/App.tsx` (`RootStackParams.Conflitos: undefined`, `Stack.Screen name="Conflitos"` com título "Conflitos"), `apps/mobile/src/screens/SettingsScreen.tsx` (linha tocável com `ListItem` + navegação), `apps/mobile/src/sync/status-text.ts` (`conflictsText`), testes `SettingsScreen.test.tsx`.
**Interfaces:** Consome `services.runtime.engine.conflicts()/resolve()`, `syncKindLabel`, `recordName`, `versionLines` (`@sagyou/core/sync/view`), `status` do store do app.
- [ ] Passo 1: testes que falham: `conflictsText(1)` = "1 conflito", `conflictsText(3)` = "3 conflitos"; Ajustes com `conflictCount: 2` mostra botão "2 conflitos" que navega para `Conflitos`, com 0 ou `readOnly` não mostra; ConflictsScreen com um `lww` mostra "Tarefa: <título>", "Versão deste aparelho · …", "Versão de <aparelho> · …", dois "Usar esta"; tocar o segundo chama `resolve(id, 'remote')`, remove o cartão e mostra "Versão escolhida."; `orphan` mostra o texto de removido e "Dispensar" → `resolve(id,'local')` e "Conflito dispensado."; `resolve` lançando `SyncUserError('Não foi possível usar esta versão.')` mantém o cartão e mostra a mensagem; lista vazia mostra "Nenhum conflito" e o texto explicativo; mudança de `status` recarrega a lista; cada cartão tem `accessibilityLabel` "Versão deste aparelho, <data>" e cada botão "Usar esta" tem `accessibilityLabel` "Usar a versão deste aparelho" / "Usar a versão de <aparelho>"; com `resolve` pendurado, os botões ficam `disabled`.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- src/screens/__tests__`. Esperado: FALHA (tela não existe; texto antigo).
- [ ] Passo 3: implemente com `Card`, `Button`, `EmptyState`, `Snackbar` e tema existentes; `busy` desabilita os botões durante a escolha.
- [ ] Passo 4: rode o mesmo comando + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): tela de conflitos`

### Task 6: versões, docs, suíte e PR

**Arquivos:** Modificar `apps/mobile/app.json`, `apps/mobile/package.json`, `apps/desktop/package.json`, `package-lock.json`, `CLAUDE.md`, `GUIDE.md`, `README.md` (seção de sync/celular: conflitos no celular, fechamento automático, envio ao sair).
- [ ] Passo 1: bump celular 0.1.0 / versionCode 100, desktop 1.2.2 (`npm install --package-lock-only`); `apps/mobile/src/__tests__/app-config.test.ts` continua passando.
- [ ] Passo 2: rode `npm run typecheck`, `npm run lint`, `npm test`. Esperado: PASSA.
- [ ] Passo 3: atualizar docs (o celular resolve conflitos; resolver sempre envia; fechar sozinho; envio ao ir para segundo plano).
- [ ] Passo 4: verificação no aparelho fica para Luis (APK pelo `mobile-apk.yml`): conflito criado editando a mesma tarefa no PC e no celular offline, resolver no celular e ver fechar no PC.
- [ ] Passo 5: commit `chore(release): celular 0.1.0, desktop 1.2.2 e docs`; /sagyou-review e PR (junto com a task do guia, se aprovada).
