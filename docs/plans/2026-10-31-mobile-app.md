# Plano de implementação: Sync, etapa 3 — app Android (v1) e `packages/core`

Status: approved by Luis on 2026-10-31
Spec: docs/specs/2026-10-31-mobile-app.md
Branch: feature/mobile-app

**Objetivo:** pôr um celular Android na sincronização da etapa 2, com um app Expo que faz
tarefas, hábitos, lançamentos, notas e busca offline, usando as mesmas regras de dados do
desktop.

**Arquitetura:** o repositório vira workspaces npm (`apps/desktop`, `apps/mobile`,
`packages/core`, `sync-server`). O `packages/core` recebe, sem Node nem Electron, os tipos,
a normalização, o dinheiro, as regras de colunas/hábitos/datas e todo o sync puro,
inclusive o `createSyncEngine` (que já recebe store, config, fetch e timers por injeção).
O celular guarda cada registro sincronizado como o próprio payload da etapa 1 numa tabela
genérica do `expo-sqlite`, monta o estado com as funções do core e implementa
`SyncStoreLike` sobre ela.

## Restrições Globais

- Três PRs, nesta ordem, cada um verde no CI antes do próximo: **A** (Tasks 1–2, Sync
  3.1), **B** (Tasks 3–6, Sync 3.2), **C** (Tasks 7–17, Sync 3.3–3.11). O trabalho é
  linear em `feature/mobile-app`; no fim da Task 2 cria-se `chore/monorepo` nesse commit
  (PR A, base `feature/sync-cloudflare`), no fim da Task 6 `feature/mobile-core` (PR B,
  base `chore/monorepo`), e o PR C sai de `feature/mobile-app` com base
  `feature/mobile-core`.
- **Testes não rodam no PC do Luis**: a verificação de cada passo "rode" é o CI do PR
  (`gh pr checks` / `gh run watch`). Os comandos citados são os que o CI executa.
- Desktop: **nenhuma mudança de dados**. `kanban.db`, backup v7, `sync-config.json`,
  `sync-device.json`, `appId`, `productName` e a pasta `userData` não mudam.
- Protocolo de sync sem mudança: lote `v: 1`, mesmas rotas do Worker, mesma cifra
  XChaCha20-Poly1305, mesmo hash canônico SHA-256 hex.
- Dinheiro é string decimal canônica em todo lugar; valor digitado passa por
  `parseDecimalInput(raw, currency)` com a moeda da tabela; totais nunca somam moedas
  diferentes.
- `packages/core` não importa `crypto`, `zlib`, `fs`, `path`, `Buffer`, `electron`,
  `react` nem `react-native`. Um teste de lint (`no-restricted-imports` +
  `no-restricted-globals: Buffer`) em `packages/core/**` garante isso.
- No celular, chave de sync e token só em `expo-secure-store`; nunca em SQLite,
  AsyncStorage, log ou estado do Zustand.
- O que é do aparelho não sincroniza no celular: perfil financeiro ativo, última tabela
  por perfil, nome do aparelho, preferências.
- Textos exatos (pt-BR):
  - "Parear com o Sagyou", "Escanear QR", "Colar código", "Baixando seus dados…"
  - "Este código expirou. Gere outro no Sagyou do PC."
  - "Sem conexão: as alterações ficam guardadas"
  - "Este aparelho foi desconectado da sincronização"
  - "N conflitos — resolva no PC" (N = número; "1 conflito — resolva no PC")
  - "Configure um bloqueio de tela no Android para usar o Sagyou."
  - "Desbloquear o Sagyou" (prompt da biometria), "Desconectar este aparelho"
  - "Nova sprint…", "Novo gasto", "Nova receita", "Próximas"
- Ritmo no celular: envio 5 s após salvar (`PUSH_DEBOUNCE_MS`), recebimento ao abrir, a
  cada 60 s (`POLL_MS`) e quando a rede volta; com o app em segundo plano, o motor para.
- Bloqueio: ao abrir e ao voltar do segundo plano depois de **300 000 ms** fora.
- Pacote Android: `com.sagyou.mobile` (decisão do construtor).

## Decisões do construtor tomadas na checagem do plano

- **Banco do celular por registro, não por tabela de domínio.** `records(kind, id,
  payload)` guarda o payload **exatamente como veio do lote ou do `extractDataRecords`**
  (texto de `canonicalJson`). `hlc`/`deleted` vêm de `sync_records` (join por kind+id).
  Excluir remove a linha de `records`; o tombstone fica em `sync_records`. O estado do app
  é `replaceSyncableState(EMPTY_STATE, wire)` sobre esse join, **sem** passar pela
  normalização no load: o payload já sai normalizado do aparelho que o criou, e
  normalizar de novo poderia gerar versões que ninguém editou. Invariante testada (Task 8):
  carregar e salvar sem editar gera **0** versões para todos os vetores da Task 3.
  Memórias ficam em `records` com `kind = 'memory'`, fora do estado, aplicadas por
  `planMemoryApply`.
- **Motor sem dependência do desktop:** `SyncEngineDeps` ganha `log?: {info, warn,
  error}(area, event, data?)` (padrão: nada). Os tipos `SyncConfig`, `SyncConfigLoad` e
  `SyncPause` vão para `@sagyou/core/sync/config-types`; `syncConfigFileName` e as
  constantes de arquivo ficam em `apps/desktop/.../sync-config.ts`.
- **Dependências do core empacotadas:** `packages/core/package.json` declara
  `@noble/ciphers`, `@noble/hashes`, `@scure/base`, `fflate`, `uuid`, `decimal.js`,
  `date-fns`; as mesmas entram em `dependencies` do desktop (o core é inlinado, as dele
  continuam externas). Teste na Task 6.
- **Aleatoriedade:** `globalThis.crypto.getRandomValues` (Node/Electron nativo; no
  celular, polyfill `react-native-get-random-values`, que usa o gerador seguro do
  Android). Substitui o "`randomBytes` injetado" da spec, que foi atualizada.
- **"Baixando seus dados…" sem contagem**: o motor não expõe progresso e não vale mudar
  o core por isso. Spec atualizada.
- **"Próximas" = todas** as tarefas não concluídas com prazo, de projetos não arquivados,
  por data, vencidas primeiro (como na spec), por uma função nova
  `upcomingTasks(tasks, projects, today)` em `@sagyou/core/dueDates`; não reaproveita
  `computeDueDateData` (que corta em 7 dias).
- **Sprint nova:** `addSprint(state, projectId, name, now)` em `@sagyou/core/sprints`
  devolve `{state, sprintId}` ou `{error}`. Nome comparado sem espaços nas pontas e sem
  diferenciar maiúsculas. Textos: "Dê um nome à sprint." e "Já existe uma sprint com esse
  nome neste projeto." O desktop não muda.
- **Notas:** o `createNote` do desktop não muda (padrão x=100, y=100, 200×150,
  `#fef08a`). O celular usa `mobileNotePosition(existing)` em `@sagyou/core/notes`:
  ignora blocos `type: 'text'`; sem notas, (100, 100); senão x = menor x, y = maior
  `y + height` + 24.
- **Busca no celular:** `search_fts(kind UNINDEXED, id UNINDEXED, profile_id UNINDEXED,
  archived UNINDEXED, title, body)`. Por kind:
  - `project`: name / description;
  - `task`: title / description + tags;
  - `note` (exceto `type: 'text'`): primeira linha / content;
  - `habit`: name / —;
  - `transaction`: description / category + counterparty, com `profile_id` vindo do
    `financial_table` dono.

  Reindexa cada registro gravado (local ou remoto). Quando um `financial_table` muda,
  reindexa as transações dele. Projeto arquivado e as tarefas e notas dele ficam fora
  (`archived = 1`), como no padrão do desktop. A consulta usa `searchMatch(term)`, movido
  de `apps/desktop/src/main/modules/search/global-search-query.ts` para
  `@sagyou/core/search`.
- **Gerador de vetores** (Task 3): script `npx tsx apps/desktop/scripts/gen-sync-vectors.ts`,
  rodado uma vez pelo construtor (é um script, não a suíte de testes), JSON commitado. O
  CI prova que os vetores batem com o código antigo (Task 3) e com o core (Task 5).

## Foco de Review

1. **Hash ou lote diferente depois da extração do core** → todo aparelho reenviaria tudo,
   ou um PC antigo não abriria lote do celular. Esperado: `hashPayload` idêntico byte a
   byte aos vetores gravados antes da mudança; lote do core abre no `zlib` do Node e lote
   antigo abre no core. Testado na Task 3 (vetores) e na Task 5.
2. **Desktop quebrado pela mudança de pasta** (módulos nativos `better-sqlite3`/`node-pty`
   não recompilados, `@sagyou/core` externalizado e ausente no pacote, versão da tag lida
   do `package.json` errado). Esperado: CI verde, release em modo de teste gera os três
   instaladores, e o app abre com o `kanban.db` existente. Testado nas Tasks 1, 2 e 6.
3. **Editar no celular apaga campo que o celular não mostra** (imagens da tarefa,
   `timeSpent`, `legacyFinancialMetadata`, auditoria). Esperado: a edição parte do
   payload completo gravado e só troca os campos do formulário. Testado nas Tasks 8, 11 e
   13.
4. **Dinheiro**: valor salvo como número, parse sem a moeda da tabela, ou saldo somando
   tabelas de moedas diferentes. Esperado: string decimal, `"1.000"` em JPY vira
   `"1000"`, saldo por tabela na moeda dela. Testado na Task 13.
5. **Segredo vazando ou dado visível com o app travado/revogado**: chave fora do
   secure-store, revogação com "apagar" deixando o banco, tela de dados aparecendo antes
   da biometria. Testado nas Tasks 10 e 16.
6. **Dados existentes do desktop**: nada em `kanban.db` muda; um banco real aberto depois
   do PR B continua sem gerar versões novas em `sync_records` (`MAX(seq)` igual depois de
   abrir e fechar sem editar). Verificado na Task 6.

---

### Task 1: workspaces npm e desktop em `apps/desktop` (Sync 3.1)

**Arquivos:**
- Mover com `git mv` para `apps/desktop/`: `src/`, `build/`, `resources/`, `scripts/`,
  `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig.json`,
  `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`.
- Criar `apps/desktop/package.json` com `name: "@sagyou/desktop"`, os campos `version`,
  `description`, `main`, `author`, `homepage`, todas as `dependencies`, as
  `devDependencies` do Electron/Vite/Vitest e os `scripts` atuais (inclusive
  `postinstall`).
- Root `package.json`: `name: "sagyou"`, `private: true`,
  `workspaces: ["apps/*", "packages/*", "sync-server"]`, `devDependencies` só de
  ESLint/Prettier/TypeScript, e scripts que repassam ao desktop: `dev`, `build`,
  `build:win/mac/linux`, `build:unpack`, `typecheck` (`--workspaces --if-present`),
  `test` (`--workspaces --if-present`), `test:coverage`, `lint`, `format`.
- Criar `packages/core/package.json` (`@sagyou/core`, `private`, `type: module`,
  `exports: {"./*": "./src/*.ts"}`), `packages/core/src/index.ts` vazio,
  `packages/core/tsconfig.json` (`moduleResolution: Bundler`, `strict`, `lib: ES2022`,
  `types: []`) e `packages/core/vitest.config.ts`.
- `sync-server/package.json`: script `test: vitest run` e `vitest` em devDependencies;
  `sync-server/vitest.config.ts` (`environment: node`). Tirar `sync-server/**` do
  `include` do vitest do desktop.
- `.gitignore`: caminhos `out/`, `dist/`, `resources/markitdown/bin`, `coverage/`
  passam a valer em qualquer workspace (`**/out/` etc.).
- `eslint.config.mjs` fica na raiz, com os globs atualizados para `apps/desktop/src/**`.
- `CLAUDE.md`, `GUIDE.md`, `AGENTS.md`: uma nota no topo de "Architecture"/"Estrutura":
  "Caminhos do desktop são relativos a `apps/desktop/`"; os comandos de "Commands"
  continuam valendo na raiz.

**Interfaces:** Produz `apps/desktop`, `packages/core` e scripts raiz usados por todas
as tasks seguintes.

- [ ] Passo 1: teste `apps/desktop/src/main/__tests__/workspace-layout.test.ts`
  (`@vitest-environment node`): lê o `package.json` raiz e espera `workspaces` igual a
  `["apps/*","packages/*","sync-server"]`; lê `apps/desktop/package.json` e espera
  `version` igual à da versão atual e `postinstall` contendo `better-sqlite3`; espera
  que `apps/desktop/electron-builder.yml` exista.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA, os arquivos ainda não existem.
- [ ] Passo 3: faça as mudanças acima. `postinstall` do desktop:
  `electron-rebuild --force --only better-sqlite3 --module-dir ../..` se o rebuild não
  encontrar o módulo içado na raiz (decisão do construtor: verificar no log do CI
  `npm ci` que ele recompila; sem isso, usar `--module-dir`).
- [ ] Passo 4: rode `npm ci && npm run typecheck && npm test` (CI). Esperado: PASSA, com
  o mesmo número de testes do desktop de antes mais o novo, e os do `sync-server` rodando
  no workspace dele.
- [ ] Passo 5: commit `chore(repo): workspaces npm com o desktop em apps/desktop`.

### Task 2: CI, release e verificação do build (Sync 3.1)

**Arquivos:** Modificar `.github/workflows/quality.yml`, `.github/workflows/release.yml`.
Teste `apps/desktop/src/main/__tests__/release-config.test.ts` (já existe; ajustar
caminhos).

**Interfaces:** Consome os scripts raiz da Task 1.

- [ ] Passo 1: em `release-config.test.ts`, mudar os caminhos lidos para
  `apps/desktop/electron-builder.yml` e o workflow; acrescentar asserções: o passo "Tag
  matches package.json" lê `apps/desktop/package.json`; o workflow tem
  `workflow_dispatch`; o job que cria o Release tem
  `if: startsWith(github.ref, 'refs/tags/')`.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA nas asserções novas.
- [ ] Passo 3: `release.yml`: `version` lida de `apps/desktop/package.json`; comandos de
  build com `-w apps/desktop`; caminhos de artefato `apps/desktop/dist/...`;
  `workflow_dispatch` roda os jobs de build e sobe os instaladores como artefatos, sem o
  job de Release. `quality.yml`: acrescentar `npm run typecheck -w sagyou-sync-server`.
- [ ] Passo 4: rode `npm test` (CI). Esperado: PASSA. Depois, disparar o
  `workflow_dispatch` do release na branch (`gh workflow run release.yml --ref
  chore/monorepo`) e conferir que os três jobs de build terminam com instalador.
- [ ] Passo 5: commit `ci(repo): caminhos do monorepo e build de teste do release`.
  Criar a branch `chore/monorepo` neste commit e abrir o **PR A** (skill `sagyou-pr`),
  base `feature/sync-cloudflare`. Luis confere `npm run dev` abrindo o app com os dados
  dele antes do merge.

### Task 3: vetores de compatibilidade do sync (Sync 3.2)

**Arquivos:** Criar `packages/core/src/__tests__/fixtures/sync-vectors.json` e o gerador
`apps/desktop/scripts/gen-sync-vectors.ts` (roda com o código atual do desktop, uma vez).
Teste `apps/desktop/src/main/__tests__/sync-vectors.test.ts`.

**Interfaces:** Produz o arquivo de vetores que as Tasks 5 consome.

- [ ] Passo 1: teste: para cada vetor (`{kind, payload, hash}` de pelo menos um registro
  de cada `SyncKind` em `DATA_KINDS` e `memory`, com dinheiro, acentos, emoji e chaves
  fora de ordem), `hashPayload(payload) === hash`; para `{keyHex, plaintextRecords,
  sealedB64, senderOpaqueId, batchId}`, `decodeBatch(openBatch(...))` devolve os
  `plaintextRecords`; `opaqueDeviceId`, `keyProof`, `toRecoveryCode` e
  `encodePairCode` batem com os valores gravados.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA, o arquivo de vetores não existe.
- [ ] Passo 3: o gerador usa as funções atuais de `src/main/modules/sync/` e grava o
  JSON; commitar o JSON gerado.
- [ ] Passo 4: rode `npm test` (CI). Esperado: PASSA (prova que os vetores refletem o
  código de hoje).
- [ ] Passo 5: commit `test(sync): vetores de compatibilidade antes do core`.

### Task 4: domínio puro no core (Sync 3.2)

**Arquivos:** Mover para `packages/core/src/` (com `git mv` e testes junto):
- `types/index.ts` → `types.ts`
- `utils/money.ts` + `main/modules/financial/money-text.ts` → `money.ts`
- de `components/financial/shared.ts`: `parseDecimalInput`, `formatAmountInput`,
  `financialCategories` → `finance.ts`
- `store/normalization.ts`, `utils/financialLegacy.ts`, `utils/yieldSummary.ts`,
  `utils/financialRecord.ts`
- `utils/columns.ts`, `utils/habits.ts`, `utils/dates.ts`, `utils/dueDates.ts`
- `main/modules/ai/memory.ts` → `memory.ts`

Os arquivos antigos do desktop viram reexportações de uma linha
(`export * from '@sagyou/core/types'`), para não tocar centenas de imports.

Criar em `finance.ts`:
- `tableBalance(transactions: FinancialTransaction[], cutoff: string): Decimal`, receitas
  menos despesas com `date <= cutoff`;
- `newTransaction(input: {type: 'income' | 'expense'; amount: string; date: string;
  category: string; description: string}, now: Date): FinancialTransaction`, com `id`,
  `createdAt` e `amount` por `moneyStr`.

`FinanceTab.tsx` passa a usar `tableBalance` para o saldo atual e o projetado.

**Interfaces:** Produz `@sagyou/core/types`, `/money`, `/finance`, `/normalization`,
`/financialRecord` (`applyFinancialTransactionEdit`), `/financialLegacy`,
`/yieldSummary`, `/columns`, `/habits` (`computeHabitSummary`), `/dates`, `/dueDates`
(+ `upcomingTasks`), `/memory`, `/sprints` (`addSprint`), `/notes`
(`mobileNotePosition`).

- [ ] Passo 1: `packages/core/src/__tests__/finance.test.ts`: `tableBalance(...).toString()`
  com uma receita de `"1500.50"` em 2026-10-01 e uma despesa de `"0.5"` em 2026-10-02,
  com corte em 2026-10-01, dá `"1500.5"`, e com corte em 2026-10-31 dá `"1500"`.
  `sprints.test.ts`: `addSprint` com " sprint 1 " num projeto que já tem "Sprint 1" dá
  o erro exato; vazio dá "Dê um nome à sprint.". `dueDates.test.ts`: `upcomingTasks`
  inclui uma tarefa com prazo em 30 dias, exclui concluída e de projeto arquivado, e
  põe a vencida primeiro. `notes.test.ts`: `mobileNotePosition([])` é (100, 100); com
  uma nota em y=100, height=150, e um bloco de texto em y=900, dá y=274;
  `newTransaction({amount: "10.10", ...})` grava `amount === "10.1"` e `createdAt`
  ISO. Mais um teste com `parseDecimalInput("1.000", "JPY")` igual a 1000.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA, o módulo não existe.
- [ ] Passo 3: mova e crie como acima. Se o `tsconfig.node.json` do desktop não resolver
  `exports`, acrescente `paths: {"@sagyou/core/*": ["../../packages/core/src/*"]}` nos
  dois tsconfigs do desktop e um alias no `vitest.config.ts` dele.
- [ ] Passo 4: rode `npm run typecheck && npm test` (CI). Esperado: PASSA, sem teste do
  desktop removido (só movido).
- [ ] Passo 5: commit `refactor(core): tipos, dinheiro e regras puras no packages/core`.

### Task 5: sync puro e motor no core (Sync 3.2)

**Arquivos:** Mover para `packages/core/src/sync/`: `hlc.ts`, `sync-records.ts` →
`records.ts`, `sync-plan.ts` → `plan.ts`, `sync-merge.ts` → `merge.ts`, `sync-batch.ts` →
`batch.ts`, `sync-crypto.ts` → `crypto.ts`, `sync-apply.ts` → `apply.ts`,
`sync-replace.ts` → `replace.ts`, `sync-engine.ts` → `engine.ts` (sem `wipeTargets` e
`wipeLocalData`, que ficam no desktop em `modules/sync/wipe.ts`). Ficam no desktop:
`device-id.ts`, `sync-config.ts`, `wipe.ts`. Testes movidos junto, menos os que testam o
que ficou.

Trocas de API do Node:
- `createHash/createHmac/hkdfSync` → `@noble/hashes` (`sha256`, `hmac`, `hkdf`);
- `randomBytes`/`randomUUID` → `globalThis.crypto.getRandomValues` e `v4` do `uuid`;
- `zlib` → `fflate` (`gzipSync`, `gunzipSync`);
- `Buffer` (base64, base64url, utf8, `byteLength`) → `@scure/base` (`base64`,
  `base64urlnopad`) e `strToU8`/`strFromU8` do `fflate`.

**Interfaces:** Produz `@sagyou/core/sync/*`, inclusive
`createSyncEngine(deps: SyncEngineDeps): SyncEngine` e `SyncStoreLike` sem mudança de
assinatura.

- [ ] Passo 1: `packages/core/src/sync/__tests__/compat.test.ts`: os vetores da Task 3
  passam com o core; `zlib.gunzipSync` do Node abre `encodeBatch` do core e devolve o
  mesmo JSON; `decodeBatch` do core abre um gzip feito por `zlib.gzipSync`. Um teste de
  lint (`packages/core/src/__tests__/no-node.test.ts`) roda o ESLint em
  `packages/core/src` (sem `__tests__`) e espera zero erros de `no-restricted-imports`/
  `no-restricted-globals`.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA, os módulos não existem no core.
- [ ] Passo 3: mova e troque as APIs. O teste de compat é o único lugar do core que usa
  `zlib` (só em `__tests__`). `log`/`errorMessage` do motor passam a vir de
`deps.log`; o desktop injeta o `log` dele.
- [ ] Passo 4: rode `npm run typecheck && npm test` (CI). Esperado: PASSA, inclusive
  `sync-vectors.test.ts` do desktop (agora importando do core).
- [ ] Passo 5: commit `refactor(core): sync e motor no packages/core sem Node`.

### Task 6: desktop sobre o core, verificação e PR B (Sync 3.2)

**Arquivos:** `apps/desktop/electron.vite.config.ts` (main e preload com
`build.externalizeDeps.exclude: ['@sagyou/core']`, para o core entrar no bundle);
`apps/desktop/package.json` com `@sagyou/core` em `devDependencies` (não vai para o
pacote); `CLAUDE.md`/`GUIDE.md`: seção curta "packages/core" (o que mora lá, a regra
"sem Node", e que regras de dinheiro/sync não se duplicam). Teste
`apps/desktop/src/main/__tests__/release-config.test.ts`.

- [ ] Passo 1: em `release-config.test.ts`, esperar que a config do electron-vite
  exclua `@sagyou/core` da externalização em `main` e `preload`, e que toda chave de
  `dependencies` de `packages/core/package.json` esteja em `dependencies` de
  `apps/desktop/package.json`.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA.
- [ ] Passo 3: ajuste a config e a documentação.
- [ ] Passo 4: rode `npm run typecheck && npm test` (CI). Esperado: PASSA. Disparar o
  `workflow_dispatch` do release e conferir os três instaladores. Verificação no app,
  por Luis, com uma cópia do `kanban.db` como `kanban-dev.db`: `npm run dev` abre os
  dados, o sync conecta e envia/recebe com o outro PC, e abrir e fechar sem editar não
  muda `MAX(seq)` de `sync_records`.
- [ ] Passo 5: commit `build(desktop): empacotar o packages/core no bundle`. Criar
  `feature/mobile-core` neste commit e abrir o **PR B**, base `chore/monorepo`.

### Task 7: projeto Expo e CI do celular (Sync 3.3)

**Arquivos:** Criar `apps/mobile/` com `create-expo-app` (template `blank-typescript`,
SDK estável atual, versões fixadas sem `^`), `app.json` (`name: "Sagyou"`,
`android.package: "com.sagyou.mobile"`, `userInterfaceStyle: "automatic"`, sem iOS),
`metro.config.js` padrão de monorepo do Expo, `index.ts` importando
`react-native-get-random-values` antes de tudo, `src/theme.ts` com as cores e
tipografia do `UI_DESIGN.md` (claro e escuro, escolhido por `useColorScheme`),
`jest.config.js` (preset `jest-expo`, `TZ=America/Sao_Paulo`), e o shell `src/App.tsx`
com `@react-navigation/bottom-tabs` (abas Tarefas, Hábitos, Finanças, Notas, Busca) e
`@react-navigation/native-stack` (formulários e Ajustes, aberto por um botão na barra
superior). As telas das abas começam como marcadores e são preenchidas nas Tasks 11–15.
`package.json` com `name: "@sagyou/mobile"`, scripts `test`, `typecheck`, e
`@sagyou/core` em `dependencies`. `quality.yml`: job "Mobile" com
`npm run typecheck -w @sagyou/mobile` e `npm test -w @sagyou/mobile`.

- [ ] Passo 1: `apps/mobile/src/__tests__/core-in-rn.test.ts`: importa
  `@sagyou/core/sync/crypto` e `@sagyou/core/sync/batch`, faz `sealBatch` →
  `openBatch` → `decodeBatch` de dois registros e compara; importa `hashPayload` e
  confere um vetor da Task 3. `App.test.tsx`: as cinco abas aparecem com os rótulos
  exatos, e o tema escuro do sistema aplica o fundo escuro do `theme.ts`.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile` (CI). Esperado: FALHA, o projeto não
  existe.
- [ ] Passo 3: crie o projeto como acima.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): projeto Expo no workspace`.

### Task 8: banco do celular e repositório de registros (Sync 3.3)

**Arquivos:** Criar em `apps/mobile/src/data/`:
- `sql.ts`: interface `SqlDb { exec(sql): void; run(sql, params?): {changes: number};
  all<T>(sql, params?): T[]; get<T>(sql, params?): T | undefined; tx<R>(fn: () => R):
  R }`, com `openExpoDb(name)` sobre `expo-sqlite` (`openDatabaseSync`) e
  `openNodeDb(path)` sobre `node:sqlite`, só para teste;
- `schema.ts`: migrações por `PRAGMA user_version`;
- `records.ts`: `RecordRepo`.

Schema v1:
- `records(kind TEXT, id TEXT, payload TEXT NOT NULL, PRIMARY KEY(kind, id))`;
- `sync_records`, `sync_state`, `sync_conflicts`, `sync_pending` com as mesmas colunas da
  etapa 2 no desktop;
- `search_fts` (FTS5: `kind UNINDEXED`, `id UNINDEXED`, `title`, `body`);
- `prefs(key TEXT PRIMARY KEY, value TEXT)`.

`RecordRepo`:
- `loadState(): MobileState`: monta o estado com `replaceSyncableState(EMPTY_STATE,
  wire)` do core sobre o join `records` × `sync_records` (sem normalizar; ver Decisões);
- `save(next: MobileState, now: number): number`: chama `extractDataRecords(next)` e
  `planSyncChanges(records, stored, {complete: true})`, grava os payloads mudados em
  `records`, as linhas de `buildSyncRows` em `sync_records` e o `search_fts` dos
  registros tocados, numa transação; devolve quantas versões novas gerou.

`MobileState` é o `SyncableState` tipado com os tipos do core.

- [ ] Passo 1: `apps/mobile/src/data/__tests__/records.test.ts` (com `openNodeDb(':memory:')`):
  - gravar um estado com uma tarefa que tem `images`, `timeSpent` e `completedAt`;
    recarregar e trocar só o título; o payload gravado mantém `images`, `timeSpent` e
    `completedAt`;
  - `save` sem mudança devolve 0;
  - gravar como recebidos todos os payloads dos vetores da Task 3, `loadState` e
    `save` sem editar devolve 0 (nenhuma versão nova);
  - uma memória recebida fica em `records` com `kind = 'memory'` e não aparece no estado;
  - excluir uma tarefa gera uma linha `deleted = 1`;
  - o banco migrado de `user_version` 0 fica em 1, e rodar de novo não muda nada.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA, o repositório não existe.
- [ ] Passo 3: implemente como acima.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): banco local por registro sincronizado`.

### Task 9: `SyncStoreLike` do celular (Sync 3.3)

**Arquivos:** Criar `apps/mobile/src/data/sync-store.ts`:
`createMobileSyncStore(db: SqlDb, repo: RecordRepo, deviceId: string): SyncStoreLike`.
- `applyRemoteRecords` usa `planRemoteApply`/`planMemoryApply` do core e grava
  `records`, versões, conflitos (`lww`, `pending_choice`, `orphan`) e `sync_pending`
  com a mesma semântica do `store.ts` do desktop.
- `replaceWithRemoteRecords` substitui todos os registros.
- `pruneSyncTombstones` segue a regra de 90 dias.

O `deviceId` são 32 hex aleatórios criados uma vez e guardados em `prefs` (do aparelho,
fora do sync). `adoptSyncVersion`, `rebaseSyncVersion` e `markSyncConflictResolved`
existem para cumprir a interface; na v1 nenhuma tela os chama.

- [ ] Passo 1: `apps/mobile/src/data/__tests__/sync-store.test.ts`:
  - um lote com projeto e tarefa aplicado em ordem invertida (tarefa antes) deixa a
    tarefa em `sync_pending` e a aplica quando o projeto chega;
  - uma tarefa editada localmente com HLC menor que a recebida perde, e a versão local
    vai para `sync_conflicts` como `lww`;
  - uma dívida mudada nos dois lados fica `pending_choice` e mantém o valor local;
  - `pendingOutgoing` depois de um `save` local lista a linha, e `markPushed` a remove;
  - `openSyncConflictCount` conta os abertos.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente portando as consultas de sync do `store.ts` do desktop para o
  `SqlDb`, com os planejadores do core.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): store de sync sobre o SQLite do celular`.

### Task 10: pareamento, motor, ajustes e revogação (Sync 3.4)

**Arquivos:**
- `apps/mobile/src/sync/config-store.ts`: `SyncConfigStore` sobre `expo-secure-store`,
  chave `sagyou.sync.config`; `availability()` sempre `'ok'`.
- `apps/mobile/src/sync/runtime.ts`: monta `createSyncEngine` com `fetch` global,
  `setTimeout`, `forcedBackup: async () => true` e `wipe`, que apaga o banco, limpa o
  secure-store e `prefs` e volta à tela de pareamento. Liga o motor no `AppState`
  `active` e o para em `background`; chama `syncNow()` quando o
  `@react-native-community/netinfo` volta a `isConnected`.
- `apps/mobile/src/store/app.ts`: Zustand `useApp`, com `state: MobileState`,
  `syncStatus`, `readOnly: boolean` e `load()`. `emitRemoteChanges` troca `state`; toda
  ação salva pelo `RecordRepo` e chama `engine.notifySaved()`.
- Telas `src/screens/PairScreen.tsx` (câmera com `expo-camera` `CameraView` lendo QR, e
  "Colar código") e `src/screens/SettingsScreen.tsx`: nome do aparelho, perfil
  financeiro, estado do sync, "N conflitos — resolva no PC", "Desconectar este
  aparelho" com confirmação.

O pareamento chama `engine.join(code, 'replace', deviceName)`; o nome padrão vem de
`expo-device` `modelName`. O estado mostra os mesmos textos da etapa 2 e, com
alterações aguardando e sem rede, "Sem conexão: as alterações ficam guardadas".

**Revogação:**
- **sem apagar:** `readOnly = true`, a faixa mostra "Este aparelho foi desconectado da
  sincronização" e as ações ficam desativadas;
- **com apagar:** chama `wipe`.

- [ ] Passo 1: testes (`jest-expo` + `@testing-library/react-native`, com `fetch`,
  secure-store e câmera simulados):
  - `PairScreen`: colar um código válido chama `join` com modo `'replace'` e mostra
    "Baixando seus dados…"; um convite vencido (o Worker responde como na etapa 2) mostra
    "Este código expirou. Gere outro no Sagyou do PC.";
  - `config-store`: depois de `save`, a chave não aparece em `prefs` nem no SQLite (varrer
    as tabelas pelo texto base64 da chave);
  - `runtime`: 401 com `wipe: true` deixa o banco vazio e o secure-store limpo; 401 sem
    `wipe` liga `readOnly`;
  - `SettingsScreen`: com 1 conflito aberto mostra "1 conflito — resolva no PC";
  - `App`: sem pareamento, só o `PairScreen` aparece (nenhuma aba);
  - faixa: com alterações aguardando e o netinfo sem conexão, mostra "Sem conexão: as
    alterações ficam guardadas";
  - `runtime` com timers falsos: `AppState` → `background` chama `engine.stop()`, →
    `active` chama `start()`; o netinfo passando a conectado chama `syncNow()`.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente como acima.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): pareamento pela câmera e sync no celular`.

### Task 11: tarefas (Sync 3.5)

**Arquivos:** `src/screens/tasks/ProjectsScreen.tsx`, `ProjectBoardScreen.tsx` (tarefas
agrupadas por coluna), `TaskFormScreen.tsx`, `UpcomingScreen.tsx` ("Próximas"). Ações em
`src/store/tasks.ts`:
- `createTask(input)`: `order` no fim da coluna; `createdAt` e `updatedAt` agora.
- `updateTask(id, patch)`: aplica o patch sobre o objeto completo.
- `moveTask(id, columnId)`: entrar numa coluna `isDoneColumn` grava `completedAt`; sair
  dela remove `completedAt`, como no slice do desktop.
- `completeTask(id)`: move para a primeira coluna `isDoneColumn` do projeto.
- `createSprint(projectId, name)`: chama `addSprint` do core e devolve o `sprintId` ou
  mostra o erro.

O formulário tem título, descrição, prioridade, prazo, tags (`DEFAULT_TAGS`), coluna e
sprint. A sprint vem preenchida com a sprint sem `closedAt` de `createdAt` mais recente;
a lista mostra só sprints abertas mais "Nova sprint…". "Próximas" usa `upcomingTasks`
do core.

- [ ] Passo 1: testes:
  - `tasks.test.ts`: `updateTask` só de título preserva `images`/`timeSpent`;
    `completeTask` grava `completedAt` e a coluna done; `moveTask` para fora de done
    limpa `completedAt`; `createSprint` com nome repetido é recusado;
  - `TaskFormScreen.test.tsx`: com duas sprints abertas, vem a mais recente;
    "Nova sprint…" cria e seleciona;
  - `UpcomingScreen.test.tsx`: a vencida aparece antes da de amanhã, e a de daqui a 30
    dias também aparece.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): tarefas no celular`.

### Task 12: hábitos (Sync 3.6)

**Arquivos:** `src/screens/HabitsScreen.tsx`, `src/store/habits.ts` com
`toggleHabit(id, isoDate: 'YYYY-MM-DD')` (mesmo nome e semântica do slice do desktop).
Datas pelo dia local, por `@sagyou/core/dates`; a sequência por `computeHabitSummary`
de `@sagyou/core/habits`.

- [ ] Passo 1: testes:
  - `toggleHabit` marca e desmarca hoje e não duplica a data;
  - a tela mostra a sequência de 3 para três dias seguidos até hoje;
  - só os últimos 7 dias são clicáveis.
  Com `TZ=America/Sao_Paulo` no `jest.config.js`.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode o job Mobile (CI). Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): hábitos no celular`.

### Task 13: lançamentos financeiros (Sync 3.7)

**Arquivos:** `src/screens/FinanceScreen.tsx`, `src/screens/TransactionFormScreen.tsx`,
`src/store/finance.ts`.
- `addTransaction(tableId, input)` usa `newTransaction` do core.
- `updateTransaction(tableId, txId, patch)` passa por `applyFinancialTransactionEdit` de
  `@sagyou/core/financialRecord`, que audita e limpa `reconciledAt`; é recusada para
  transação com `debtId`,
  `linkedTransactionId`, `currencyTransferId` ou em detalhe de fatura.
- Prefs `finance.profileId` (padrão `personal`) e `finance.lastTable.<profileId>`.
- O seletor de tabela mostra só as tabelas do perfil ativo.
- O saldo é `tableBalance(transactions, hoje)` na moeda da tabela.
- A lista mostra o mês atual.
- As categorias vêm de `financialCategories` com as do perfil.

- [ ] Passo 1: testes:
  - lançar `"1.234,56"` numa tabela BRL grava `"1234.56"`, e `"1.000"` numa JPY grava
    `"1000"`;
  - editar o valor grava uma entrada em `audit` e limpa `reconciledAt`;
  - editar o valor preserva `receiptFileIds`, `details`, as entradas anteriores de
    `audit` e o `legacyFinancialMetadata` da tabela;
  - uma transação de dívida não abre para edição;
  - o seletor esconde as tabelas de outro perfil;
  - a última tabela usada volta pré-selecionada;
  - nenhum total soma tabelas de moedas diferentes: a tela mostra só a tabela escolhida.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode o job Mobile e o CI completo. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): gastos e receitas no celular`.

### Task 14: notas (Sync 3.8)

**Arquivos:** `src/screens/NotesScreen.tsx`, `src/screens/NoteEditScreen.tsx`,
`src/store/notes.ts`. Nota nova com os padrões do `createNote` do desktop (200×150,
`#fef08a`) na posição de `mobileNotePosition` (Task 4). O desktop não muda.

- [ ] Passo 1: testes:
  - criar uma nota num projeto com uma nota em y=100, height=150 grava y=274, 200×150,
    `#fef08a`;
  - editar o texto preserva `x`, `y`, `width` e `color`;
  - blocos de texto do canvas (só visuais) não aparecem na lista.
- [ ] Passo 2: rode o job Mobile e o CI. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): notas no celular`.

### Task 15: busca (Sync 3.9)

**Arquivos:** Mover `searchMatch(term): {tokens, match}` de
`apps/desktop/src/main/modules/search/global-search-query.ts` para
`@sagyou/core/search`; o desktop importa dele. Criar `src/screens/SearchScreen.tsx` e
`src/data/search.ts` com `searchRecords(db, text, profileId, limit = 50)`, sobre o
`search_fts` descrito nas Decisões:
`WHERE search_fts MATCH ? AND archived = 0 AND (kind <> 'transaction' OR profile_id = ?)`,
ordenado por `bm25` com peso de título maior. Tocar no resultado navega para o item.

- [ ] Passo 1: testes:
  - "merc" acha a transação "Mercado" do perfil ativo e não a de outro perfil;
  - mover uma tabela de perfil (registro `financial_table` recebido) muda o resultado
    das transações dela;
  - uma tarefa de projeto arquivado não aparece;
  - uma tarefa excluída sai da busca;
  - texto vazio não consulta;
  - aspas e `*` digitados não quebram a consulta.
- [ ] Passo 2: rode o job Mobile e o CI. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode. Esperado: PASSA. Se o `node:sqlite` do CI não tiver FTS5, o teste
  falha com essa mensagem: nesse caso, o `openNodeDb` usa `better-sqlite3` compilado para
  Node no workspace mobile (decisão do construtor).
- [ ] Passo 5: commit `feat(mobile): busca no celular`.

### Task 16: bloqueio (Sync 3.10)

**Arquivos:** `src/lock/LockGate.tsx`, que envolve a navegação. Com
`expo-local-authentication`:
- `getEnrolledLevelAsync() === SecurityLevel.NONE` → mostra só "Configure um bloqueio
  de tela no Android para usar o Sagyou.";
- senão, `authenticateAsync({promptMessage: 'Desbloquear o Sagyou'})`, com o PIN, o
  padrão ou a senha do Android como alternativa.

Trava ao abrir e quando o `AppState` volta a `active` depois de ≥ 300 000 ms em
`background`. Enquanto travado, nada do `useApp().state` é renderizado, e o motor de sync
continua só em primeiro plano, como na Task 10.

- [ ] Passo 1: testes:
  - ao montar, mostra a tela de bloqueio e não o conteúdo;
  - com sucesso, mostra o conteúdo;
  - em segundo plano por 299 s, não pede de novo; por 300 s, pede;
  - com `SecurityLevel.NONE`, mostra o texto exato e não o conteúdo.
- [ ] Passo 2: rode o job Mobile (CI). Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: rode. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): bloqueio por biometria`.

### Task 17: APK, revisão, documentação e PR C (Sync 3.11)

**Arquivos:**
- `.github/workflows/mobile-apk.yml`, disparado por `workflow_dispatch` e por tag
  `mobile-v*`, com `permissions: contents: read`, actions fixadas por SHA e
  `persist-credentials: false`. Passos: Node 24 e Java 17, `npm ci`, `npx expo prebuild
  -p android --no-install` em `apps/mobile`, keystore decodificado de
  `ANDROID_KEYSTORE_BASE64` com `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e
  `ANDROID_KEY_PASSWORD`, `./gradlew assembleRelease`, e o artefato
  `sagyou-mobile-<version>.apk`.
- `apps/mobile/plugins/withReleaseSigning.js`: config plugin que lê essas variáveis no
  build.
- `README.md`: "App Android", com como gerar o keystore uma vez (`keytool`), cadastrar
  os secrets, rodar o workflow, instalar o APK e parear. Avisa que perder o keystore
  obriga a desinstalar.
- `CLAUDE.md`/`GUIDE.md`: arquitetura do celular (`records` genérico, `SqlDb`,
  secure-store, bloqueio, o que é do aparelho).
- Teste `apps/desktop/src/main/__tests__/release-config.test.ts`.

- [ ] Passo 1: em `release-config.test.ts`, esperar que `mobile-apk.yml` não tenha
  `contents: write`, use `persist-credentials: false` e só leia os quatro secrets
  citados.
- [ ] Passo 2: rode `npm test` (CI). Esperado: FALHA.
- [ ] Passo 3: crie o workflow, o plugin e a documentação.
- [ ] Passo 4: CI completo verde. `/sagyou-review` com `sagyou-security-reviewer`
  (secure-store, wipe, bloqueio, workflow de assinatura) e `sagyou-ui-reviewer` (telas do
  celular). Luis cadastra os secrets, roda o workflow, instala o APK e testa:
  - parear pela câmera;
  - criar uma tarefa offline no celular e outra no PC, e reconectar: as duas chegam;
  - lançar um gasto: ele aparece no PC em até 1 min;
  - marcar um hábito;
  - buscar;
  - o bloqueio volta depois de 5 min fora;
  - revogar com apagar pelo PC: o celular volta à tela de pareamento, sem dados.
- [ ] Passo 5: commit `ci(mobile): APK assinado pelo GitHub Actions` e
  `docs(mobile): app Android`. Abrir o **PR C** (skill `sagyou-pr`), base
  `feature/mobile-core`.
