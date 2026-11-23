# Plano de implementação: Handoff por sessão e proteção de edição de memória

Status: approved by Luis on 2026-11-23
Spec: docs/specs/2026-11-23-handoff-por-sessao.md
Branch: feature/handoff-por-sessao

**Objetivo:** cada sessão de terminal tem o próprio handoff, gravado desde o início e finalizado na saída; sessões abertas se enxergam por uma ferramenta MCP; e `update_memory` recusa edição sobre versão antiga.

**Arquitetura:** regras puras no core (`handoffId` com `runId`, limite de 5, estados por tag) e numa função pura do desktop (`interrompida`); um módulo de checkpoints no processo principal que grava o handoff `em andamento` **localmente, sem versão de sync**; `store.ts` marca `interrompida` ao abrir o banco, **antes** do `reconcileSyncRecords`; `list_active_sessions` lê as runs vivas + os checkpoints em memória; `expectedUpdatedAt` entra no `prepareMemoryOp` do `update_memory`.

## Restrições Globais

- **Testes só no CI** (regra do Luis, 2026-10-30): nada de `npm test`/`typecheck`/`lint` local. Os "Passos de rodar" abaixo valem como **push + `gh pr checks`**. Branch sem PR não tem CI, então o build abre um **PR em rascunho** logo depois da Task 1 (pedir confirmação ao Luis antes). Empurrar no fim de cada fase (A: T1–T3, B: T4–T6, C: T7–T9, D: T10), não a cada passo.
- Tempos e limites exatos da spec: checkpoint a cada escrita aplicada por MCP com no máximo 1 gravação a cada **15 s** por run; tick a cada **2 min** enquanto a run vive; só grava se o texto mudou; limite de **5** handoffs ativos por projeto (e por `global`); `list_active_sessions` devolve no máximo **20** sessões, **12** ações e **20** arquivos cada; briefing mostra até **3** sessões ativas.
- Id novo: `handoff:<projectId|global>:<runId>`. `handoffId(projectId)` sem `runId` continua devolvendo `handoff:<projectId|global>` (legado).
- Estados: tags `em-andamento` / `interrompida`; título com prefixo `[em andamento] ` / `[interrompida] `; linha `Status: em andamento` / `Status: interrompida` no corpo; os estados finais de hoje (`completed`, `cancelled`, `failed`, `not_applied`) não mudam de texto nem de tag.
- Textos exatos: `A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: <updatedAt anterior, ISO>.` e `A memória foi alterada depois da sua leitura (agora: <updatedAt>). Leia de novo com read_memory e refaça a edição.`
- `expectedUpdatedAt` é opcional e comparado como **texto exato**.
- Checkpoint `em andamento` **nunca** gera versão de sync; só a gravação que sai desse estado (finalização, `interrompida`) é capturada. `list_active_sessions` não persiste nada e não mexe no decaimento.
- `packages/core` sem Node (`no-node.test.ts`). Nada de `console.*` no main (use `log`). Nunca logar corpo de memória, título, tokens.
- Memória é satélite: escritas dela **nunca** passam por `persistAll`/`store:save`.
- Compatibilidade: handoffs antigos (`handoff:<projectId>`) continuam válidos, decaem pelo TTL e entram na contagem do limite de 5.
- Versão: PR sobe o **desktop** de 1.13.0 para **1.14.0** (feature compatível). O celular não muda (sem bump).
- **(decisão do construtor) Briefing:** handoffs `em andamento` (da própria run e de irmãs) **saem** das listas `relevantMemories` e `recentHandoffs` do briefing, porque têm bloco próprio; os `interrompida` continuam como histórico. Só uma run **com projeto** recebe o bloco `SESSÕES EM ANDAMENTO NESTE PROJETO`; sessão geral não recebe (a ferramenta cobre esse caso).
- **(decisão do construtor) Preservar a linha existente:** checkpoint e finalização leem o handoff atual da run (`getMemory(handoffId(projectId, runId))`) e preservam `pinned`, `createdAt`, `accessCount` e `archivedAt`. Um handoff que o usuário fixou continua fixado; um que ele arquivou continua arquivado (a gravação não o reativa).
- **(decisão do construtor) Correção da ordenação por data** (`selectRecentMemories`/`handoffsText`) fica num `fix/` à parte e **não bloqueia** este trabalho: todo handoff novo usa `toISOString()`, então a ordem textual coincide com a de data; o código novo ordena por `Date.parse`. Recomenda-se mergear o fix antes.
- **(decisão do construtor) `ai:memory:handoff`:** só a ponte do preload (`preload/index.ts`) e o handler o usam; **nenhum chamador no renderer**. Continua com o id legado por projeto e fica como candidato à limpeza, não é removido aqui.
- **(decisão do construtor) `sync-vectors.json`** não contém `handoff` (conferido); a mudança do id é aditiva e não toca em hashes.

## Foco de Review

1. **Checkpoint tardio sobrescreve a finalização.** Um checkpoint assíncrono (o `diffSince` demora) que termina depois de `stop()` não pode regravar `em andamento` por cima do estado final. Esperado: `stop(runId)` cancela timers e descarta o resultado em voo. Testado na Task 4.
2. **Linha `em andamento` deixada por queda é versionada como "em andamento".** O `reconcileSyncRecords` roda no `getDb` e captura todas as memórias (`complete: true`). Esperado: a marcação `interrompida` roda **antes** dele no mesmo `getDb`, e checkpoints nunca capturam. Testado na Task 2 (regra pura) e verificado no app na Task 10 (o SQL não roda no vitest).
3. **Dado persistido existente.** Handoffs `handoff:<projectId>` (um por projeto) continuam sendo lidos, listados, arquivados pelo TTL e contados no limite; `handoffId(projectId)` sem `runId` não muda. Esperado: nada some, nada é renomeado. Testado na Task 1.
4. **Duas sessões / limite de 5 arquivando a viva, e checkpoint desfazendo o que o usuário fez.** O limite não pode arquivar um handoff `em andamento` com run viva nem um fixado, e o checkpoint não pode desafixar nem reativar um handoff que o usuário fixou ou arquivou. Esperado: ficam, mesmo passando de 5; pin e arquivamento sobrevivem aos checkpoints. Testado nas Tasks 1, 3, 4 e 5.
5. **`update_memory` com versão velha.** Entre o `prepare` e o `apply` a memória pode mudar de novo. Esperado: a checagem roda nas **duas** chamadas de `prepareMemoryWrite` (já é chamada duas vezes), sem escrever nada quando falha. Testado na Task 9.
6. **Escopo da `list_active_sessions`.** Uma sessão de projeto não vê sessões de outro projeto sem `projectId`; nunca devolve a própria run; nunca devolve handoff `em andamento` sem run viva (backup restaurado). Testado na Task 7.

### Task 1: Regras puras no core (id por sessão, estados e limite)
**Arquivos:**
- Modificar: `packages/core/src/memory.ts`
- Teste: criar `packages/core/src/__tests__/memory-handoff.test.ts`; ajustar `apps/desktop/src/main/__tests__/memory.test.ts` só se um teste existente depender do formato do id (os de `handoffId(projectId)` continuam valendo)

**Interfaces:**
- Produz (todas exportadas de `@sagyou/core/memory`, reexportadas por `modules/ai/memory.ts`):
  - `handoffId(projectId: string | null, runId?: string): string` → `handoff:<projectId ?? 'global'>` sem `runId`; `handoff:<projectId ?? 'global'>:<runId>` com.
  - `handoffRunId(id: string): string | null` → o `runId` de um id novo; `null` para o legado ou para um id que não é de handoff.
  - `HANDOFF_KEEP = 5`, `HANDOFF_RUNNING_TAG = 'em-andamento'`, `HANDOFF_INTERRUPTED_TAG = 'interrompida'`.
  - `isRunningHandoff(m: AiMemory): boolean` → `type === 'handoff'`, sem `archivedAt` e com a tag `em-andamento`.
  - `selectHandoffOverflow(memories: AiMemory[], liveRunIds: ReadonlySet<string>): string[]`.

- [ ] Passo 1: escreva o teste que falha (`memory-handoff.test.ts`): `handoffId('p1')` é `handoff:p1`, `handoffId(null)` é `handoff:global`, `handoffId('p1','r1')` é `handoff:p1:r1`, `handoffId(null,'r1')` é `handoff:global:r1`; `handoffRunId('handoff:p1:r1')` é `r1`, `handoffRunId('handoff:p1')` é `null`, `handoffRunId('outro:x')` é `null`; `isRunningHandoff` verdadeiro só para handoff ativo com a tag; `selectHandoffOverflow` com 7 handoffs ativos do mesmo projeto (`updatedAt` distintos, um deles com `Date` em formato `+00:00` e outro sem milissegundos, para provar a ordem por `Date.parse`) devolve os ids dos 2 mais antigos; **não** devolve um fixado nem um `em andamento` cujo `runId` está em `liveRunIds`, mesmo passando de 5; projetos diferentes e `global` contam separado; handoffs arquivados não contam; um handoff legado (`handoff:p1`) conta no limite; um `em andamento` **sem** run viva é elegível ao arquivamento; memórias de outro `type` nunca aparecem no resultado.
- [ ] Passo 2: confirme a falha (CI da fase A): as funções não existem; `handoffId` não aceita o 2º argumento.
- [ ] Passo 3: implemente em `packages/core/src/memory.ts`. `selectHandoffOverflow` agrupa por `projectId ?? 'global'`, ordena por `Date.parse(updatedAt)` desc (NaN conta como 0) com `id` asc de desempate, e devolve os que passam do índice 5, exceto fixados e `isRunningHandoff` com `handoffRunId(id)` em `liveRunIds`. Atualize o comentário de `handoffId` e o de `findConflicts` ("um por projeto" deixa de ser verdade).
- [ ] Passo 4: CI da fase A: PASSA.
- [ ] Passo 5: commit `feat(memory): id de handoff por sessão e limite por projeto`

### Task 2: `interrompida` como função pura
**Arquivos:**
- Criar: `apps/desktop/src/main/modules/ai/handoff-state.ts`
- Teste: criar `apps/desktop/src/main/__tests__/handoff-state.test.ts` (`@vitest-environment node`)

**Interfaces:**
- Consome (Task 1): `isRunningHandoff`, `HANDOFF_RUNNING_TAG`, `HANDOFF_INTERRUPTED_TAG`, tipo `AiMemory`.
- Produz:
  - `RUNNING_TITLE_PREFIX = '[em andamento] '`, `INTERRUPTED_TITLE_PREFIX = '[interrompida] '`, `RUNNING_STATUS_LINE = 'Status: em andamento'`, `INTERRUPTED_STATUS_LINE = 'Status: interrompida'`.
  - `markHandoffInterrupted(memory: AiMemory, now: string): AiMemory` → título com o prefixo trocado; tags com `em-andamento` trocada por `interrompida`; corpo com a linha `Status:` trocada e a linha `Resultado: …` trocada por `Resultado: A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: <memory.updatedAt>.`; `updatedAt = now`, `lastAccessedAt = now`; mantém `Referências: run=…`, ações, decisões, pendências e arquivos.
  - `interruptRunningHandoffs(memories: AiMemory[], now: string): AiMemory[]` → só as que `isRunningHandoff`, já transformadas.

- [ ] Passo 1: escreva o teste que falha: a partir de um corpo `em andamento` completo (Pedido, Assunto, Resultado, Status, Ações, Pendências, Arquivos, `Referências: run=r1`), `markHandoffInterrupted` produz título `[interrompida] Sessão de terminal: <assunto>`, tags `['handoff','terminal','interrompida']`, corpo com `Status: interrompida`, **sem** `Status: em andamento`, com a linha `Resultado: A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: 2026-11-23T10:20:00.000Z.` e com todas as outras linhas intactas; título sem assunto (`[em andamento] Sessão de terminal`) vira `[interrompida] Sessão de terminal`; `interruptRunningHandoffs` ignora handoff finalizado, handoff arquivado, memória de outro tipo e handoff legado sem a tag.
- [ ] Passo 2: confirme a falha (CI da fase A): arquivo não existe.
- [ ] Passo 3: implemente em `handoff-state.ts`, por substituição de linha (`^Status: .*$`, `^Resultado: .*$`), sem reconstruir o corpo.
- [ ] Passo 4: CI da fase A: PASSA.
- [ ] Passo 5: commit `feat(memory): marca handoff sem saída normal como interrompida`

### Task 3: `buildTerminalHandoff` com id por sessão e estado `em andamento`
**Arquivos:**
- Modificar: `apps/desktop/src/main/modules/agent/terminal-handoff.ts`
- Teste: `apps/desktop/src/main/__tests__/terminal-handoff.test.ts`

**Interfaces:**
- Consome (Tasks 1–2): `handoffId(projectId, runId)`, os prefixos e a linha de status de `handoff-state.ts`.
- Produz: `TerminalHandoffInput.status` ganha `'running'`; `buildTerminalHandoff(input, now, existing?: AiMemory | null)` usa **sempre** `handoffId(input.projectId, input.runId)` e repassa `existing` ao `buildMemory`; depois do build restaura `memory.archivedAt = existing?.archivedAt ?? null` (o `buildMemory` reativa por padrão). `pinned`, `createdAt` e `accessCount` já vêm preservados do `existing`.
  - `running` (ignora `input.result`; a linha `Resultado:` é sempre a fixa abaixo): título `[em andamento] Sessão de terminal: <assunto>` (ou `[em andamento] Sessão de terminal` sem assunto), cortado em 120; tags `['handoff','terminal','em-andamento']`; `Resultado: Sessão em andamento; este registro é do último checkpoint.`; `Status: em andamento`; rótulo `Arquivos alterados até o último checkpoint (N):`.
  - demais estados: iguais aos de hoje.

- [ ] Passo 1: ajuste/escreva testes que falham: o id de um handoff final agora é `handoff:<projeto>:<run>` (os testes que esperavam `handoffId(projectId)` passam a esperar o novo); `status: 'running'` dá título com prefixo, as tags, `Status: em andamento` e o rótulo de arquivos acima; `running` e depois `completed` do **mesmo** `runId` têm o **mesmo** id (é a mesma linha); duas runs do mesmo projeto têm ids **diferentes**; `Referências: run=<id>` sobrevive ao corte de 2 400 caracteres também no estado `running`; `status: 'running'` com `result: 'xyz'` ainda produz a linha fixa `Resultado: Sessão em andamento; este registro é do último checkpoint.`; com `existing` fixado (`pinned: true`), `createdAt` e `accessCount: 3`, o resultado mantém os três; com `existing.archivedAt` preenchido, o resultado continua arquivado; sem `existing`, `pinned: false` e `archivedAt: null`.
- [ ] Passo 2: confirme a falha (CI da fase A): id sem `runId`, status `running` inexistente.
- [ ] Passo 3: implemente em `terminal-handoff.ts`; o prefixo vem de `handoff-state.ts` (uma só definição).
- [ ] Passo 4: CI da fase A: PASSA.
- [ ] Passo 5: commit `feat(agent): handoff de terminal por sessão, com estado em andamento`

### Task 4: Checkpoints durante a sessão
**Arquivos:**
- Modificar: `apps/desktop/src/main/modules/agent/run-activity.ts`
- Criar: `apps/desktop/src/main/modules/agent/session-checkpoint.ts`
- Teste: `apps/desktop/src/main/__tests__/run-activity.test.ts`; criar `apps/desktop/src/main/__tests__/session-checkpoint.test.ts` (`@vitest-environment node`, `vi.useFakeTimers()`)

**Interfaces:**
- Consome (Task 3): `buildTerminalHandoff`, `TerminalHandoffInput`.
- Produz:
  - `createRunActivity().peek(runId: string): RunActivityEntry[]` → cópia, **sem** esvaziar a run (`take` continua esvaziando).
  - ```ts
    export interface CheckpointSnapshot {
      runId: string
      projectId: string | null
      startedAt: number // ms
      updatedAt: number // ms do último checkpoint gravado
      subject?: string
      actions: string[]
      files: string[]
    }
    export interface SessionCheckpointDeps {
      now: () => number
      /** Dados da run no momento; null quando a run já não existe. `input.request` é a fonte do pedido. */
      read: (runId: string) => Promise<{
        projectId: string | null
        startedAt: number
        input: Omit<TerminalHandoffInput, 'runId' | 'projectId' | 'status' | 'result'>
      } | null>
      /** A linha atual do handoff desta run (para preservar pin, createdAt, accessCount e archivedAt). */
      getMemory: (id: string) => AiMemory | null
      /** Grava localmente, SEM captura de sync. */
      write: (memory: AiMemory) => void
      onError: (runId: string, error: unknown) => void
    }
    export function createSessionCheckpoints(deps: SessionCheckpointDeps): {
      start(runId: string): void       // grava já e liga o tick de 2 min
      touch(runId: string): void       // escrita aplicada por MCP; máx. 1 gravação/15 s, com uma gravação final agendada
      stop(runId: string): void        // cancela timers e descarta o que estiver em voo; idempotente
      resetAll(): void                 // esquece o último texto de cada run viva e regrava (após um backup restaurado)
      snapshot(runId: string): CheckpointSnapshot | null
      live(): CheckpointSnapshot[]
    }
    ```
  - Constantes exportadas: `CHECKPOINT_MIN_GAP_MS = 15_000`, `CHECKPOINT_TICK_MS = 120_000`.

- [ ] Passo 1: escreva os testes que falham: (a) `peek` devolve as entradas e uma segunda chamada devolve as mesmas; `take` depois de `peek` ainda devolve tudo e esvazia; (b) `start` chama `write` uma vez com `[em andamento]`; (c) três `touch` em 5 s geram **uma** gravação imediata e **uma** agendada para 15 s depois da primeira; (d) o tick de 2 min regrava só se o texto mudou (mesmo `read` duas vezes seguidas → uma gravação); (e) `stop` durante um `read` em voo: ao resolver, **não** chama `write`; (f) depois de `stop`, `touch` e o tick não gravam; (g) `read` que devolve `null` não grava, não quebra e **para** os timers daquela run sozinho (uma run que sumiu sem `stop` não deixa tick vivo); (g2) `resetAll` regrava cada run viva mesmo com o texto igual ao último; (g3) com `getMemory` devolvendo uma linha fixada e arquivada, o `memory` passado a `write` continua fixado e arquivado; (h) erro em `read`/`write` chama `onError` e as próximas tentativas seguem funcionando; (i) `snapshot`/`live` devolvem assunto, ações e arquivos do último checkpoint **bem-sucedido** e nada para run parada; (j) duas runs do mesmo projeto gravam em ids diferentes.
- [ ] Passo 2: confirme a falha (CI da fase B): módulo e `peek` não existem.
- [ ] Passo 3: implemente. Por run: `busy`/`again` (um `read` em voo por vez; se chegar outro pedido, roda uma vez mais ao terminar), `lastWriteAt`, `lastText` (`title + '\n' + body + '\n' + tags.join(',')`), `stopped`. O `write` passa pelo `buildTerminalHandoff(input, now, deps.getMemory(handoffId(projectId, runId)))` com `status: 'running'`, `result: ''` (ignorado nesse estado) e `now = new Date(deps.now()).toISOString()`.
- [ ] Passo 4: CI da fase B: PASSA.
- [ ] Passo 5: commit `feat(agent): checkpoints do handoff durante a sessão`

### Task 5: Persistência local, `interrompida` ao abrir e limite no prune
**Arquivos:**
- Modificar: `apps/desktop/src/main/store.ts`, `apps/desktop/src/main/handlers/memory.ts`
- Modificar também: `apps/desktop/src/main/modules/ai/handoff-state.ts` (a função de arquivamento abaixo)
- Teste: criar `apps/desktop/src/main/__tests__/memory-handlers.test.ts` (`@vitest-environment node`; `registerMemoryHandlers(ipcMain, deps)` é injeção pura: um `ipcMain` falso captura `handle` e o teste chama os handlers); estender `handoff-state.test.ts`

**Interfaces:**
- Consome: `interruptRunningHandoffs` (Task 2), `selectHandoffOverflow` (Task 1).
- Produz:
  - `archiveHandoffOverflow(deps: { list: () => AiMemory[]; archive: (ids: string[], now: string) => void; live: () => ReadonlySet<string>; now: () => string }): string[]` em `handoff-state.ts` — arquiva `selectHandoffOverflow(deps.list(), deps.live())` e devolve os ids (uma só implementação, usada pelo prune e pela finalização).
  - `store.upsertMemoryLocal(m: AiMemory): void` — igual a `upsertMemory` (linha + `syncMemorySearchRows`), **sem** `captureSafely`.
  - Em `getDb()`, imediatamente **antes** de `reconcileSyncRecords(_db)`: `interruptRunningHandoffsOnOpen(_db)` — seleciona `type='handoff' AND archived_at IS NULL AND tags LIKE '%"em-andamento"%'`, aplica `interruptRunningHandoffs(rows, new Date().toISOString())`, grava com `writeMemoryRow` e chama `syncMemorySearchRows(_db)` no fim (o `memory_fts` não pode ficar com o título antigo); falha só é logada (`log.error('store', 'interrupt_handoffs_failed', { msg })`) e nunca impede a abertura.
  - `handlers/memory.ts`: deps novas `liveRunIds: () => ReadonlySet<string>` e `onReplaced?: () => void`; `runMemoryPrune()` arquiva `selectStale(...)` **e** chama `archiveHandoffOverflow` (sem repetir ids; o total devolvido soma os dois); o handler `ai:memory:replace` chama `deps.onReplaced?.()` depois de gravar com sucesso (o import de backup apaga a linha `em andamento` das runs vivas; o `index.ts` liga isso a `sessionCheckpoints.resetAll()` na Task 6).
  - O handler `ai:memory:handoff` continua usando `handoffId(projectId)` (legado), sem mudança.

- [ ] Passo 1: escreva os testes que falham: `archiveHandoffOverflow` com 7 handoffs arquiva 2 e devolve os ids, não toca no `em andamento` com run viva nem no fixado; `ai:memory:prune` arquiva excedentes de handoff **e** os velhos de `selectStale` sem contar um id duas vezes; `ai:memory:replace` chama `onReplaced` só quando a gravação deu certo (e não chama quando falha). O SQL de `store.ts` não roda no vitest (better-sqlite3 do Electron); fica para a Task 10.
- [ ] Passo 2: confirme a falha (CI da fase B): `liveRunIds`, `onReplaced` e `archiveHandoffOverflow` não existem.
- [ ] Passo 3: implemente em `store.ts`, `handoff-state.ts` e `handlers/memory.ts`; o registro dos handlers recebe `liveRunIds` e `onReplaced` do `index.ts` (Task 6). O corpo transformado vem **da função pura**, não de SQL.
- [ ] Passo 4: CI da fase B: PASSA.
- [ ] Passo 5: commit `feat(memory): handoff interrompido ao abrir e limite de 5 por projeto`

### Task 6: Ligar checkpoints, finalização e limite no `index.ts`
**Arquivos:**
- Modificar: `apps/desktop/src/main/index.ts`
- Teste: nenhum arquivo novo. O `index.ts` não é importável isoladamente (como já está dito em `CLAUDE.md`); a lógica de cada ligação já é testada nas Tasks 3, 4 e 5 e a ligação em si é verificada no app (Task 10, passos a–e)

**Interfaces:**
- Consome: `createSessionCheckpoints` (Task 4), `memoryStore.upsertMemoryLocal` e `archiveHandoffOverflow` (Task 5), `runActivity.peek`, `summarizeRunActivity`, `diffSince(run.base)`, `memoryStore.getMemory`.
- Produz (comportamento no `index.ts`):
  - Instância `sessionCheckpoints` ao lado de `runActivity`, com `getMemory: memoryStore.getMemory`, `write: memoryStore.upsertMemoryLocal`, `onError: (runId, error) => log.warn('pty', 'handoff_checkpoint_failed', { runId, msg: errorMessage(error) })`. `read(runId)` monta `projectId`, `startedAt` e `input` com `request = run.task`, `decisions = [...run.decisions, ...summary.decisions]`, `actions`, `pending`, `subject` (igual a `persistTerminalHandoff`: `run.task === BLANK_SESSION_TASK ? summary.subject : run.task`) e `changedFiles` dos caminhos de `await diffSince(run.base)` (vazio se `run.base` for `null` ou o diff falhar); devolve `null` se `codeRuns` já não tem a run.
  - **`start` só depois de o PTY subir:** `sessionCheckpoints.start(run.id)` logo depois de `startAgentPty(...)` retornar sem lançar (a chamada em `index.ts`, dentro do `try` que segue o bloco do `finishExternal`), **não** logo depois de `codeSessions.register(run)`, porque o caminho de falha de início (`releaseFailedStart`, `success: false`) não passa pelo `finally` da saída. Defesa extra: toda saída que remove a run de `codeRuns` (o `finally` do `finishExternal` e o ramo que limpa um início falho) chama `sessionCheckpoints.stop(run.id)`, que é idempotente; e o próprio módulo para sozinho quando `read` devolve `null`.
  - Em `recordRunActivity`, depois de `runActivity.record(...)`: `sessionCheckpoints.touch(request.runId)`.
  - No `finally` da saída, **antes** de `persistTerminalHandoff(run, exitCode, archived)`: `sessionCheckpoints.stop(run.id)`. `persistTerminalHandoff` passa a ler `memoryStore.getMemory(handoffId(run.projectId, run.id))` e a chamar `buildTerminalHandoff(input, now, existing)`, grava com `memoryStore.upsertMemory` (com captura) e, logo depois, chama `archiveHandoffOverflow({ list: () => memoryStore.listMemories({ includeArchived: false }), archive: memoryStore.archiveMemories, live: () => new Set(codeRuns.keys()), now: () => new Date().toISOString() })` em `try/catch` com `log.warn`.
  - `registerMemoryHandlers(..., { liveRunIds: () => new Set(codeRuns.keys()), onReplaced: () => sessionCheckpoints.resetAll() })`.

- [ ] Passo 1: nenhum teste unitário novo (ver acima); escreva a lista de verificação da Task 10 antes de implementar.
- [ ] Passo 2: sem passo de falha.
- [ ] Passo 3: implemente as ligações acima.
- [ ] Passo 4: CI da fase B: PASSA; `npm run typecheck` do CI cobre os tipos do `index.ts`.
- [ ] Passo 5: commit `feat(agent): grava o handoff da sessão desde o início e o finaliza na saída`

### Task 7: Ferramenta `list_active_sessions`
**Arquivos:**
- Modificar: `apps/desktop/src/main/modules/agent/sagyou-mcp.ts`, `apps/desktop/src/main/index.ts`
- Teste: `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`, `apps/desktop/src/main/__tests__/mcp-external-broker.test.ts` (a lista de ferramentas é cruzada com `MCP_PERMISSIONS`)

**Interfaces:**
- Consome (Task 4): `CheckpointSnapshot`/`live()`.
- Produz:
  - `MCP_PERMISSIONS` ganha `'list_active_sessions'` (propaga para `CODE_EXECUTOR_MCP_PERMISSIONS` e `EXTERNAL_PERMISSIONS`).
  - Dep do broker: `activeSessions?: (filter: { projectId?: string; excludeRunId: string }) => ActiveSessionView[]` (`projectId` ausente = todos os projetos; nunca `null`), com
    `ActiveSessionView = { runId: string; projectId: string | null; iniciadaEm: string; ultimoRegistroEm: string; assunto: string | null; acoes: string[]; arquivos: string[] }` (ISO nas duas datas; `acoes` ≤ 12; `arquivos` ≤ 20).
  - Ferramenta: nome `list_active_sessions`; `inputSchema: { projectId?: string }`, `additionalProperties: false`; resposta `{ total: number, sessoes: ActiveSessionView[] }` (≤ 20). Descrição: `Lista as outras sessões de terminal em andamento agora (assunto até o momento, ações aplicadas e arquivos já alterados). Chame ao começar e antes de editar arquivos, para não mexer na mesma parte do código que outra sessão. Sem projectId, uma sessão de projeto vê o próprio projeto; sessão geral e o acesso externo veem todos. Não inclui a sua própria sessão.`
  - `projectId` presente e que não é texto → recusa `Argumentos inválidos para list_active_sessions.`
  - No `index.ts`: `activeSessions` filtra `sessionCheckpoints.live()` pelas runs que seguem em `codeRuns`, por `projectId` (quando o filtro vier), exclui `excludeRunId`, ordena por `startedAt` desc e corta em 20.

- [ ] Passo 1: escreva os testes que falham: `tools/list` inclui `list_active_sessions` (e o teste que compara os nomes com `MCP_PERMISSIONS` continua verde); sem outras sessões → `{ total: 0, sessoes: [] }`; devolve só sessões do projeto da sessão chamadora quando não há `projectId`; com `projectId` de outro projeto devolve as desse; sessão sem projeto (geral) e o token externo (`runId: 'external'`) veem todos; **não** devolve a própria run (`excludeRunId = session.runId`); `projectId: 42` → falha com o texto acima; a chamada **não** aciona `touchMemory`; com `isLocked` bloqueando leitura, recusa como as outras leituras; respeita o corte de 20.
- [ ] Passo 2: confirme a falha (CI da fase C): ferramenta inexistente.
- [ ] Passo 3: implemente no broker (definição + ramo do `tools/call`, usando `readProjectId` para o filtro) e a dep em `index.ts`.
- [ ] Passo 4: CI da fase C: PASSA.
- [ ] Passo 5: commit `feat(mcp): list_active_sessions para ver as outras sessões do projeto`

### Task 8: Briefing e texto de recall
**Arquivos:**
- Modificar: `apps/desktop/src/main/modules/agent/agent-briefing.ts`, `apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (descrições de `list_recent_memories` **e** `search_memory`), `apps/desktop/src/main/index.ts` (chamada do briefing, ~linha 2607)
- Teste: `apps/desktop/src/main/__tests__/agent-briefing.test.ts`, `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`

**Interfaces:**
- Consome (Task 7): `ActiveSessionView`.
- Produz: `ExternalAgentBriefInput.activeSessions?: { assunto: string | null; arquivos: string[] }[]`; seção `## SESSÕES EM ANDAMENTO NESTE PROJETO` via `historicalBlock` (limite 1 200 caracteres), uma linha por sessão (até 3): `- <assunto ou "Sessão sem assunto"> — <n> arquivo(s): <até 5 arquivos>`, **fora** da condição `input.memories.length`; `MEMORY_RECALL_ROUTE` ganha `Handoffs com [em andamento] são de sessões abertas agora (veja list_active_sessions) e os com [interrompida] terminaram sem saída normal.`; a seção `DADOS VIVOS` ganha `Antes de editar arquivos, chame list_active_sessions.`; as descrições de `list_recent_memories` e de `search_memory` ganham a mesma frase dos estados.
- No `index.ts` (montagem do briefing): `relevantMemories` e `recentHandoffs` **descartam** os que `isRunningHandoff` (têm bloco próprio); `recentHandoffs` pede `limit: 6` e corta em 2 depois do filtro, para um `em andamento` não esconder os históricos. `activeSessions` só é preenchido quando `run.projectId` é um id (sessão geral não recebe o bloco), pela mesma função da Task 7, com `projectId = run.projectId` e `excludeRunId = run.id`.

- [ ] Passo 1: escreva os testes que falham: com duas sessões ativas o briefing contém o cabeçalho e as duas linhas; sem sessões não contém o cabeçalho; as sessões aparecem mesmo quando `memories` não está vazio; cortam em 3; um segredo no assunto sai `[REDIGIDO]`; o texto de `MEMORY_RECALL_ROUTE` e as descrições de `list_recent_memories` e `search_memory` contêm `[em andamento]` e `[interrompida]`. O filtro dos `em andamento` do briefing é uma função pura exportada de `agent-briefing.ts`, `withoutRunningHandoffs(memories: AiMemory[]): AiMemory[]`, com teste: remove só o `em andamento`, mantém `interrompida`, finalizados e memórias de outro tipo.
- [ ] Passo 2: confirme a falha (CI da fase C).
- [ ] Passo 3: implemente os pontos acima.
- [ ] Passo 4: CI da fase C: PASSA.
- [ ] Passo 5: commit `feat(agent): briefing e recall mostram sessões em andamento`

### Task 9: `expectedUpdatedAt` no `update_memory`
**Arquivos:**
- Modificar: `apps/desktop/src/main/modules/agent/mcp-write-tools.ts`, `apps/desktop/src/main/modules/agent/sagyou-mcp.ts` (`memoryReadResult` e `memorySearchResult`)
- Teste: `apps/desktop/src/main/__tests__/mcp-write-tools.test.ts`, `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`

**Interfaces:**
- Produz: `update_memory` aceita `expectedUpdatedAt?: string` (schema: `text('updatedAt lido com read_memory; recusa a edição se a memória mudou desde então.')`); em `prepareMemoryOp`, depois de `editableMemory(...)` e antes de `editMemory`: tipo errado → `refuseMemory('expectedUpdatedAt inválido.')`; valor diferente de `existing.updatedAt` → `refuseMemory('A memória foi alterada depois da sua leitura (agora: ' + existing.updatedAt + '). Leia de novo com read_memory e refaça a edição.')`. `read_memory` e cada item de `search_memory` passam a devolver `updatedAt` (aditivo; `list_recent_memories` já devolve). A descrição da ferramenta ganha `Passe expectedUpdatedAt (o updatedAt que você leu) para não sobrescrever uma edição feita por outra sessão.`

- [ ] Passo 1: escreva os testes que falham: igual → edita; diferente → não escreve e responde exatamente o texto da spec com o `updatedAt` atual; ausente → edita como hoje; `expectedUpdatedAt: 5` → `expectedUpdatedAt inválido.`; memória inexistente e handoff continuam recusando com **as recusas de hoje** (a checagem de versão vem depois); mudança **entre o `prepare` e o `apply`** (o `getMemory` do 2º `prepareMemoryWrite` devolve outro `updatedAt`) → recusa e nada gravado; `read_memory` e `search_memory` devolvem `updatedAt` igual ao da memória.
- [ ] Passo 2: confirme a falha (CI da fase C).
- [ ] Passo 3: implemente os pontos acima.
- [ ] Passo 4: CI da fase C: PASSA.
- [ ] Passo 5: commit `feat(mcp): update_memory recusa edição sobre versão antiga`

### Task 10: Fechamento — suíte, verificação no app, docs, versão e PR
**Arquivos:**
- Modificar: `CLAUDE.md`, `GUIDE.md`, `apps/desktop/package.json`, `package-lock.json` (`packages["apps/desktop"]`), `apps/desktop/src/renderer/src/guide/content.ts` se algum artigo falar de handoff por projeto
- Teste: `apps/desktop/src/main/__tests__/release-config.test.ts` (amarra a versão)

- [ ] Passo 1: docs: em `CLAUDE.md` e `GUIDE.md`, trocar "um handoff por projeto" por "um por sessão" (terminal handoff, memória satélite, lista de ferramentas de leitura com `list_active_sessions`, `update_memory` com `expectedUpdatedAt`, regra "checkpoint `em andamento` não gera versão de sync, e a marcação `interrompida` roda antes do `reconcileSyncRecords`"); conferir `README.md` e o guia in-app (`guide/content.ts`) e corrigir o que disser "um handoff por projeto".
- [ ] Passo 2: subir o desktop para **1.14.0** nos dois arquivos de versão.
- [ ] Passo 3: suíte completa, typecheck e lint no CI (`gh pr checks`), sem local.
- [ ] Passo 4: **verificação no app** (`npm run dev`, o SQL não roda no vitest): (a) abrir duas sessões do mesmo projeto, ver dois handoffs `[em andamento]` no MemoryView e `list_active_sessions` listando a outra; (b) fechar uma normalmente: o handoff dela vira o estado final e a outra continua `em andamento`; (c) matar o app (`kill -9`) com uma sessão aberta, reabrir: a linha vira `[interrompida]` com o texto da spec e **não** aparece como "em andamento" em `list_active_sessions`; (d) conferir que a linha `interrompida` ganhou versão de sync e a `em andamento` nunca teve (`sync_records`); (e) 6º handoff do mesmo projeto arquiva o mais antigo; (f) `update_memory` com `expectedUpdatedAt` velho recusa; (g) fixar um handoff `em andamento` no MemoryView e esperar o próximo checkpoint: continua fixado; arquivar outro e esperar: continua arquivado; (h) restaurar um backup com uma sessão aberta: a linha `em andamento` dela reaparece logo (`resetAll`) e continua sem versão de sync; (i) abrir uma sessão que falha ao iniciar (CLI inexistente): nenhuma linha `em andamento` fica para trás nem timer vivo.
- [ ] Passo 5: PR (estágio 5, `sagyou-pr`), dizendo que **não quebra formato**: o id novo é aditivo e os handoffs antigos continuam válidos.
- [ ] Passo 6: commit `docs(handoff-por-sessao): documentação e versão 1.14.0`
