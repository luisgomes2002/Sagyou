# Plano de implementação: Tela de conflitos do sync, campo a campo

Status: approved by Luis on 2026-11-10
Spec: docs/specs/2026-11-10-sync-conflitos-tela.md
Branch: feature/sync-conflitos-tela

**Objetivo:** comparar as duas versões de um conflito campo a campo, em português, e
salvar uma versão mesclada, igual no PC e no celular.

**Arquitetura:** toda a regra fica no core: `sync/conflict-view.ts` (puro: rótulos,
valores legíveis, diff por palavras, comparação e pré-seleção) e
`engine.resolve(id, choice)`, que passa a aceitar uma escolha por campo, monta o
payload mesclado e o grava por `store.adoptSyncVersion` (caminho que já existe).
Desktop (`SyncSettings` + componente novo) e celular (lista + tela `Conflito`) só
desenham o que o core devolve.

## Restrições Globais

- Sem mudança de dados: nenhuma tabela, coluna, arquivo ou campo de backup novo;
  `sync-vectors.json` não é regenerado.
- Core sem Node (`no-node.test.ts`): nada de `crypto`, `Buffer`, `Intl` além de
  `toLocaleString('pt-BR')`, já usado por `versionTimeText`.
- `resolve(id, 'local' | 'remote')` continua funcionando como hoje (os testes atuais
  de `describe('conflitos')` em `sync-engine.test.ts` passam sem mudança).
- Fora da escolha: `id` e `updatedAt`. Sem escolha por campo: `kind === 'financial_debt'`,
  `kind === 'memory'`, `type === 'orphan'` ou um lado `deleted`/sem payload.
- Pré-seleção: lado com maior HLC; `timeSpent` pelo maior número.
- Textos exatos (todos em `CONFLICT_TEXTS`, no core):
  - `explain`: "O mesmo item mudou em dois aparelhos antes de um receber a mudança do outro. Escolha o que fica; a escolha vai para todos os aparelhos."
  - `thisDevice`: "Este aparelho"
  - `newer`: "Mais recente"
  - `empty`: "(vazio)"
  - `onlyIn(d)`: "Só em <d>"
  - `equalSection(n)`: "Igual nos dois (<n>)"
  - `diffHint`: "Trecho diferente destacado"
  - `timeNote`: "Marcamos o maior tempo para não perder tempo do cronômetro."
  - `save`: "Salvar escolha"
  - `keepNewer`: "Ficar com a mais recente"
  - `keepThis`: "Ficar com a deste aparelho"
  - `keepOther(d)`: "Ficar com a de <d>"
  - `useThis`: "Usar a deste aparelho" / `useOther(d)`: "Usar a de <d>"
  - `deleted`: "Apagado"
  - `summary(n, d)`: "1 campo diferente · mais recente: <d>" / "<n> campos diferentes · mais recente: <d>"
  - `missingRef`: "(item não encontrado)"
  - `alreadyResolved`: "Este conflito já foi resolvido em outro aparelho."
  - `changed`: "O item mudou enquanto você comparava. Confira de novo."
  - `chooseAll`: "Escolha um valor para cada campo diferente."
- Textos que continuam: "Nenhum conflito", "Versão escolhida.", "Conflito dispensado.",
  "Removido: o item de origem foi apagado em outro aparelho", "Dispensar",
  "Não foi possível usar esta versão.", "hora desconhecida".
- Celular: alvos de 48 dp (`MIN_TOUCH`), sem hex solto, `a11y.test.tsx` cobre a tela
  nova. Desktop: `UI_DESIGN.md`, sem `beforeunload`.
- Versões: desktop MINOR (1.11.1 → 1.12.0), celular MINOR (0.6.0 → 0.7.0, versionCode 700).
- E2E só no CI do GitHub; testes unitários locais estão ok.

## Decisões do construtor (da checagem do plano)

- **Qual lado é a versão atual:** `SyncConflictView` ganha `current: Side`
  (`keptIsLocal ? 'remote' : 'local'`, calculado em `conflicts()`). `currentHlcOf(c)`
  = `c[c.current].hlc`. Campo novo só na view em memória; nada persistido.
- **Base da versão mesclada:** `adoptSyncVersion` ignora `record.hlc`/`baseHlc` e
  minta por hash (`captureBaseHlc`). Se, antes de adotar, a versão atual era uma
  edição deste aparelho ainda não enviada (`unsent()`, a guarda que já existe), o
  engine chama em seguida `store.rebaseSyncVersion(kind, id, conflict.remote.hlc, now)`
  para a mescla sair por cima da versão que o outro aparelho tem. Assim ele aplica sem
  conflito novo. Nos outros casos a base já é a versão do outro.
- **Erros `changed` / `alreadyResolved` na tela:** a UI compara a mensagem com
  `CONFLICT_TEXTS.changed` / `.alreadyResolved` (mesmas constantes do core).
  `changed` → relê `conflicts()`, refaz `compareConflict` e a pré-seleção, e mostra a
  mensagem. `alreadyResolved` → desktop relê a lista (o cartão some) e mostra o toast;
  celular volta para a lista com snackbar. Um conflito que venceu os 30 dias com a
  tela aberta também cai em `alreadyResolved` (raro; aceito).
- **Lista de campos:** `FIELD_ORDER: Record<SyncKind, readonly string[]>` em
  `conflict-view.ts`, na ordem de `extractDataRecords`. Ela define a ordem de
  `differing`/`equal` e as chaves de `FIELD_LABELS`; chave fora da lista vai no fim,
  em ordem alfabética, com rótulo genérico. Teste: com a fixture `everyField()`, toda
  chave produzida está em `FIELD_ORDER`, **e** toda entrada de `FIELD_ORDER` aparece
  na saída (assim a fixture não pode deixar campo de fora).
- **Campo vazio escolhido:** todo campo do payload, exceto `id`/`updatedAt`, aparece na
  comparação (`images` como "3 imagens"). Escolher o lado "(vazio)" é decisão
  explícita e omite a chave. Os campos que `apply.ts` mantém do pai
  (`KEPT_ON_PARENT`) continuam preservados pelo próprio apply.
- **Nome do módulo:** rótulos e valores ficam em `sync/conflict-view.ts`, e não em
  `sync/view.ts` como dizia a spec (só organização).

## Foco de Review

1. **Campo perdido na mescla.** Um campo presente em só uma versão (ex.: `images`,
   `legacyFinancialMetadata`, `completedAt`) sai na mescla com o valor do lado
   escolhido, e um campo igual sai com o valor comum, nunca some. Testado na Task 2.
2. **Escolha sobre um item que mudou.** Edição local ou recebida entre abrir e salvar
   → `changed`, nada gravado, conflito aberto. Testado na Task 2.
3. **Conflito fechado sozinho enquanto aberto.** → `alreadyResolved`, nada gravado.
   Testado na Task 2 (engine) e Task 4 (celular fecha a tela).
4. **Convergência entre aparelhos.** A versão mesclada chega ao outro aparelho, fecha o
   conflito de lá e os hashes dos dois batem (`dataHashes(a) == dataHashes(b)`), sem
   conflito novo. Testado na Task 2.
5. **Dados existentes / tipos excluídos.** Conflitos já guardados (`sync_conflicts`
   de antes da mudança) abrem na tela nova; dívida, memória, apagado e órfão recusam
   a escolha por campo com "Dados inválidos." e seguem pelo caminho antigo. Testado
   nas Tasks 1 e 2 (Task 2 inclui uma linha empurrada direto em `a.store.conflicts`,
   no formato antigo, que abre em `conflicts()` com `current` certo e passa por
   `compareConflict`).

### Task 1: comparação pura no core (`conflict-view.ts`)

**Arquivos:** Criar `packages/core/src/sync/conflict-view.ts`; Teste
`packages/core/src/sync/__tests__/conflict-view.test.ts`.

**Interfaces:**
- Consome: `SyncConflictView`, `SyncVersionView` (`sync/engine.ts`), `SyncKind`,
  `extractDataRecords` (`sync/records.ts`), `parseHlc` (`sync/hlc.ts`).
- Produz:
  ```ts
  export type Side = 'local' | 'remote'
  export type NameLookup = (kind: SyncKind, id: string) => string | null
  export interface Segment { text: string; changed: boolean }
  export interface FieldValue { text: string; present: boolean; segments?: Segment[] }
  export interface FieldRow { field: string; label: string; local: FieldValue; remote: FieldValue }
  export interface ConflictComparison {
    choosable: boolean
    newer: Side | null          // null quando as duas HLC não dão ordem
    differing: FieldRow[]       // ordem da lista de campos do tipo
    equal: FieldRow[]
    initial: Record<string, Side>   // só campos de `differing`
    timeNote: boolean
  }
  export const CONFLICT_TEXTS: { … }   // os textos da Restrição Global
  export function fieldLabel(kind: SyncKind, field: string): string
  export function formatFieldValue(kind: SyncKind, field: string, value: unknown, names: NameLookup): string
  export function wordDiff(a: string, b: string): { local: Segment[]; remote: Segment[] } | null
  export function canChooseFields(c: SyncConflictView): boolean
  export function compareConflict(c: SyncConflictView, names: NameLookup): ConflictComparison
  export function conflictSummary(c: SyncConflictView, cmp: ConflictComparison): string
  ```
- [ ] Passo 1: testes que falham:
  - `fieldLabel`: cada campo de cada registro produzido por `extractDataRecords` sobre
    a fixture `everyField()` (do próprio teste, com todo campo de todo tipo preenchido)
    tem rótulo explícito em `FIELD_LABELS` (não o genérico); `fieldLabel('task','timeSpent')`
    = "Tempo gasto", `('task','order')` = "Posição na coluna", `('task','description')`
    = "Descrição"; campo desconhecido `fooBar` → "Foo bar".
  - `formatFieldValue`: `timeSpent` 7500 → "2 h 05 min", 2700 → "45 min", 30 → "30 s",
    0 → "0 s"; `dueDate` "2026-11-10" → "10/11/2026"; `createdAt` ISO → igual a
    `new Date(v).toLocaleString('pt-BR')`; `true` → "Sim"; `priority` "urgent" →
    "Urgente" (low/medium/high → Baixa/Média/Alta); `order` 3 → "Posição 4";
    `tags` ["a","b"] → "a, b"; `images` com 3 itens → "3 imagens" (1 → "1 imagem");
    `amount` "1500.5" → "1500,5"; `columnId` resolvido por `names` → nome, não
    encontrado → "(item não encontrado)"; `undefined`/`''`/`[]` → "(vazio)".
  - `wordDiff('a b c', 'a x c')` marca só `b` e `x` como `changed`; textos somando
    mais de 4000 palavras → `null`.
  - `compareConflict` sobre o caso da spec (task com description, timeSpent 7200 local
    e 6000 remoto, order diferentes; local mais recente): `differing` = description,
    timeSpent, order (nessa ordem); `equal` inclui title e não inclui `id` nem
    `updatedAt`; `initial` tudo `local`; `timeNote` false. Com o remoto mais recente e
    timeSpent local maior: `initial.timeSpent` = 'local', o resto 'remote',
    `timeNote` true.
  - Campo só de um lado: `present: false` e texto "(vazio)" no lado sem valor.
  - `description` > 80 caracteres ou com `\n` recebe `segments`; `title` curto não.
  - `canChooseFields` false para `financial_debt`, `memory`, `orphan`, um lado
    `deleted`; true para task `lww`.
  - `conflictSummary` → "3 campos diferentes · mais recente: Dell"; 1 →
    "1 campo diferente · mais recente: Dell"; mais recente local → "… mais recente:
    Este aparelho".
- [ ] Passo 2: `npm test -w @sagyou/core -- src/sync/__tests__/conflict-view.test.ts`.
  Esperado: FALHA (módulo não existe).
- [ ] Passo 3: implemente em `conflict-view.ts`; `newer` compara `parseHlc` (ms, depois
  counter, depois deviceId); diff por LCS de palavras (separando por espaço,
  preservando os espaços nos segmentos).
- [ ] Passo 4: mesmo comando + `npm test -w @sagyou/core -- no-node`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): comparação de conflito campo a campo no core`.

### Task 2: `engine.resolve` com escolha por campo

**Arquivos:** Modificar `packages/core/src/sync/engine.ts`; Teste
`apps/desktop/src/main/__tests__/sync-engine.test.ts` (novo `describe('conflitos campo a campo')`).

**Interfaces:**
- Consome: `canChooseFields`, `CONFLICT_TEXTS` (Task 1).
- Produz (além do campo `current: Side` em `SyncConflictView`):
  ```ts
  export type ConflictChoice =
    | Side
    | { fields: Record<string, Side>; expectedHlc: string | null }
  resolve(conflictId: string, choice: ConflictChoice): void
  ```
  `expectedHlc` = `currentHlcOf(c)` (`c[c.current].hlc`), helper em `conflict-view.ts`.
- [ ] Passo 1: testes que falham (usando `pairedDevices`, `task(...)` e `clock` do arquivo):
  - descrição de A + `timeSpent` de B: `resolve(id, { fields: { description: 'local',
    timeSpent: 'remote', … }, expectedHlc })` → em A a task tem a descrição de A e o
    tempo de B; `a.engine.conflicts()` vazio; depois de `PUSH_DEBOUNCE_MS` e
    `b.engine.syncNow()`, B tem a mesma task, `b.engine.conflicts()` vazio,
    `dataHashes(a.store)` = `dataHashes(b.store)`, e B não abriu conflito novo.
  - campo só no lado remoto (`completedAt` só em B) escolhido 'remote' aparece na
    mescla; escolhido 'local' some da mescla; campo igual (`title`) mantém o valor.
  - **edição local não enviada + mescla**: A corrige a task à mão offline depois do
    conflito, mescla; `rebaseSyncVersion` é chamado com `conflict.remote.hlc`; após
    sync, B aplica sem conflito novo e os hashes batem.
  - `conflicts()` preenche `current`: 'remote' quando a guardada é de A, 'local' quando
    a guardada é de B.
  - conflito no formato antigo (linha empurrada em `a.store.conflicts`) abre e aceita
    escolha por campo.
  - a versão mesclada tem HLC maior que as duas (`syncRecordVersion('task','t1').hlc`).
  - escolha igual à versão inteira remota (todos 'remote') segue o caminho de
    `resolve(id,'remote')` (spy em `rebaseSyncVersion` chamado como no teste
    existente, `adoptSyncVersion` não chamado).
  - faltando um campo diferente em `fields` → `SyncUserError` "Escolha um valor para
    cada campo diferente.", nada gravado.
  - `expectedHlc` diferente da versão atual (A editou a task depois de ler) →
    "O item mudou enquanto você comparava. Confira de novo.", conflito continua.
  - conflito fechado (já não está em `listSyncConflicts`) com escolha por campo →
    "Este conflito já foi resolvido em outro aparelho."; `resolve(id,'local')` com id
    inexistente mantém "Conflito não encontrado.".
  - dívida (`pending_choice`), memória, órfão e lado apagado com escolha por campo →
    "Dados inválidos.".
  - pai ausente (escolher `projectId` de um projeto que não existe aqui) →
    "Não foi possível usar esta versão." e conflito aberto.
- [ ] Passo 2: `npm test -w sagyou -- src/main/__tests__/sync-engine.test.ts`.
  Esperado: FALHA (resolve só aceita string).
- [ ] Passo 3: em `resolve`: escolha objeto → valida tipo (`canChooseFields`), acha a
  linha (senão `alreadyResolved`), compara `expectedHlc` com
  `store.syncRecordVersion(kind,id)?.hlc ?? null` (senão `changed`), monta o payload:
  para cada chave da união dos dois payloads, sem `id`/`updatedAt`, valor do lado
  escolhido (campo diferente sem escolha → `chooseAll`; igual → valor comum; ausente
  no lado escolhido → chave omitida), `id` do registro e `updatedAt = new
  Date(now).toISOString()`. Se `hashPayload` da mescla é igual ao de um lado,
  delega a `resolve(id, aquele lado)`. Senão guarda `wasUnsent = unsent()`, chama
  `store.adoptSyncVersion({ kind, id, hlc: '', baseHlc: null, deleted: false, payload }, now)`
  no mesmo try/catch de hoje e, se `wasUnsent`, `store.rebaseSyncVersion(kind, id,
  remoteHlc, now)`. Depois log `conflict_resolved` `{ adopted: true, merged: true }`,
  marca resolvido, `notifySaved()`, `publish()`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA, inclusive os testes antigos de
  `describe('conflitos')`.
- [ ] Passo 5: commit `feat(sync): resolver conflito com escolha por campo`.

### Task 3: desktop: IPC e cartão de conflito

**Arquivos:** Modificar `apps/desktop/src/main/handlers/sync.ts`,
`apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/components/settings/SyncSettings.tsx`;
Criar `apps/desktop/src/renderer/src/components/settings/SyncConflictCard.tsx`;
Teste `apps/desktop/src/main/__tests__/sync-handlers.test.ts`,
`apps/desktop/src/renderer/src/__tests__/components/SyncConflictCard.test.tsx`,
`apps/desktop/src/renderer/src/__tests__/components/SyncSettings.test.tsx`.

**Interfaces:**
- Consome: `ConflictChoice` (Task 2), `compareConflict`, `conflictSummary`,
  `CONFLICT_TEXTS`, `currentHlcOf` (Task 1).
- Produz: `sync:resolve(id, choice: ConflictChoice)`; preload
  `sync.resolve(conflictId: string, choice: ConflictChoice): Promise<SyncResult>`;
  `SyncConflictCard({ conflict, names, busy, onResolve(choice), onOpenChange })`.
  `names` no `SyncSettings` vem de `useKanbanStore` (projetos, colunas, sprints,
  tasks, tabelas financeiras, perfis, hábitos, metas, fontes de rendimento: id → nome).
- [ ] Passo 1: testes que falham:
  - handler: objeto `{ fields: { title: 'local' }, expectedHlc: null }` chega ao
    engine; `fields` com valor fora de 'local'/'remote', mais de 64 chaves, chave com
    mais de 64 caracteres, ou `expectedHlc` não string/null → "Dados inválidos." sem
    chamar o engine.
  - cartão fechado mostra "Task: Coletor…" e "3 campos diferentes · mais recente:
    Dell"; clicar abre e mostra `explain`, o selo "Mais recente" na versão certa,
    só os campos diferentes com rótulo em português, "Igual nos dois (N)" recolhido
    (abre com clique), a descrição inteira com os trechos `changed` em `<mark>`.
  - rádios vêm marcados pela pré-seleção; com o maior tempo do lado antigo aparece
    `timeNote`.
  - **Salvar escolha** chama `onResolve({ fields: <marcados>, expectedHlc })`;
    trocar um rádio muda o `fields` enviado; **Ficar com a mais recente** envia todos
    do lado mais recente; o segundo botão diz "Ficar com a deste aparelho" ou
    "Ficar com a de Dell" conforme o lado mais recente.
  - dívida/memória/apagado: sem rádios, botões "Usar a deste aparelho" / "Usar a de
    Dell" que enviam `'local'`/`'remote'`; apagado mostra "Apagado". Órfão: texto e
    **Dispensar** de hoje.
  - `SyncSettings`: resposta `changed` → relê `sync.conflicts()` e o cartão mostra os
    valores novos com a pré-seleção refeita; `alreadyResolved` → relê e o cartão some.
  - `SyncSettings`: erro do engine aparece como hoje e o conflito continua; sucesso →
    "Versão escolhida." e o cartão some. Foco vai para o cartão aberto; Tab percorre
    os rádios.
- [ ] Passo 2: `npm test -w sagyou -- src/main/__tests__/sync-handlers.test.ts src/renderer/src/__tests__/components/SyncConflictCard.test.tsx src/renderer/src/__tests__/components/SyncSettings.test.tsx`.
  Esperado: FALHA.
- [ ] Passo 3: implemente; o `VersionCard` antigo e o uso de `versionLines` saem do
  `SyncSettings` (o `versionLines` continua exportado no core enquanto o celular o usar,
  e sai na Task 4). Rádios agrupados em `role="radiogroup"` com `aria-label` = rótulo
  do campo.
- [ ] Passo 4: mesmo comando + `npm run typecheck`. Esperado: PASSA.
- [ ] Passo 5: commit `feat(sync): tela de conflitos campo a campo no PC`.

### Task 4: celular: lista e tela `Conflito`

**Arquivos:** Modificar `apps/mobile/src/screens/ConflictsScreen.tsx`,
`apps/mobile/src/App.tsx` (stack raiz `Conflito: { id: string }`, título "Conflito");
Criar `apps/mobile/src/screens/ConflictScreen.tsx`; Modificar
`packages/core/src/sync/view.ts` (remove `versionLines` e `MAX_FIELDS` se ninguém mais
usa) e seu teste; Teste `apps/mobile/src/screens/__tests__/ConflictsScreen.test.tsx`,
`apps/mobile/src/screens/__tests__/ConflictScreen.test.tsx`, `apps/mobile/src/__tests__/a11y.test.tsx`.

**Interfaces:**
- Consome: Tasks 1 e 2 (`engine.resolve(id, choice)` direto, como hoje).
- Produz: tela `Conflito`; `names` montado do estado de `useApp` (mesmos tipos da Task 3).
- [ ] Passo 1: testes que falham:
  - lista: cada cartão mostra título e `conflictSummary`; tocar navega para
    `Conflito` com o id; órfão mantém **Dispensar** na lista; vazio igual a hoje.
  - `Conflito`: `explain`, as duas versões com "Este aparelho · <hora>" /
    "Dell · <hora>" e "Mais recente"; campos diferentes com rádio de 48 dp e rótulo
    "Descrição: usar a de Dell" / "Descrição: usar a deste aparelho"; "Igual nos dois
    (N)" recolhido; trecho destacado com `accessibilityHint` = `diffHint`.
  - **Salvar escolha**, **Ficar com a mais recente** e o segundo botão chamam
    `engine.resolve` com o mesmo formato da Task 3; sucesso → volta para a lista com
    snackbar "Versão escolhida."; erro → snackbar com a mensagem e a tela fica.
  - o conflito some de `engine.conflicts()` (fechou sozinho) com a tela aberta → volta
    para a lista com snackbar `alreadyResolved`.
  - erro `changed` → a tela relê o conflito, mostra os valores novos com a
    pré-seleção refeita e o snackbar `changed`.
  - com `readOnly` a lista não navega para `Conflito` (o cartão não é tocável).
  - `useLockState.hidden` ou `readOnly` → a tela fecha (`goBack`).
  - `a11y.test.tsx` varre a tela nova (rótulos, 48 dp, sem `allowFontScaling={false}`).
- [ ] Passo 2: `npm test -w @sagyou/mobile -- src/screens/__tests__/ConflictScreen.test.tsx src/screens/__tests__/ConflictsScreen.test.tsx src/__tests__/a11y.test.tsx`.
  Esperado: FALHA.
- [ ] Passo 3: implemente com os componentes de `ui.tsx` (`Card`, `Button`, `Chip`
  para os selos, `Snackbar`), cores de `theme.ts` (destaque: `theme.attention` em
  fundo translúcido + `textDecorationLine: 'underline'`); rodapé fixo com os botões.
- [ ] Passo 4: mesmo comando + `npm test -w @sagyou/core` + `npm run typecheck`.
  Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): tela de conflito campo a campo`.

### Task 5: guia, docs, versões, review e PR

**Arquivos:** Modificar `packages/core/src/sync/guide.ts` e
`apps/desktop/src/renderer/src/guide/sync-content.ts` (trechos sobre conflitos:
"escolher campo a campo" em vez de só "Usar esta"), testes de guia;
`CLAUDE.md`, `GUIDE.md` (linha do engine/conflitos), `apps/desktop/package.json`
1.12.0, `apps/mobile/app.json` 0.7.0 / versionCode 700 (+ `package.json` do mobile e
o lock, conforme `app-config.test.ts`).
- [ ] Passo 1: teste de guia que falha: o artigo de conflitos dos dois apps contém
  "escolher campo a campo" e não contém "Usar esta". A frase do core "A comparação é
  do item inteiro" continua (a detecção não muda), seguida de "mas na tela de
  conflitos dá para escolher campo a campo o que fica".
- [ ] Passo 2: rode os testes de guia (`npm test -w @sagyou/core -- guide`,
  `npm test -w sagyou -- sync-content`). Esperado: FALHA.
- [ ] Passo 3: atualize textos, docs e versões.
- [ ] Passo 4: `npm run typecheck`, `npm run lint`, `npm test` (via `sagyou-test-runner`).
  Esperado: PASSA. Verificação no app com Luis (`npm run dev`): criar um conflito
  editando a mesma task no PC e no celular offline, abrir, misturar campos, salvar e
  conferir os dois lados. APK pelo `mobile-apk.yml` na branch.
- [ ] Passo 5: commit `docs(sync-conflitos-tela): guia, docs e versões`; `/sagyou-review`
  (geral + UI) e `/sagyou-pr`.
