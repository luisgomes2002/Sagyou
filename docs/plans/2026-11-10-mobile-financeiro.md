# Plano de implementação: Celular — financeiro completo

Status: approved by Luis on 2026-11-10
Spec: docs/specs/2026-11-10-mobile-financeiro.md
Branch: feature/mobile-financeiro

**Objetivo:** o celular faz no financeiro o mesmo que o desktop, com as mesmas regras.

**Arquitetura:**
- As regras de escrita do slice financeiro do desktop vão para `packages/core/src/finance-actions.ts`. São funções puras sobre `FinancialTable[]` que devolvem a nova lista ou um erro.
- As contas de tela (consolidado por moeda, gasto por categoria, progresso de meta) vão para `packages/core/src/finance-views.ts`.
- O desktop passa a chamar as duas sem mudar nenhum resultado.
- O celular usa as duas a partir de `apps/mobile/src/store/finance.ts`, gravando por `commit`.
- As telas do celular ficam em `apps/mobile/src/screens/finance/`.

## Restrições Globais

- **Testes:** não rodam no PC (pedido do Luis). Cada task faz commit de teste + código, push e lê o resultado no CI do PR. O PR abre como rascunho na Task 1. Typecheck e lint locais são permitidos.
- **Desktop sem mudança de resultado:** `apps/desktop/src/renderer/src/__tests__/store/financial.test.ts` e os testes de componentes financeiros passam **sem alteração** em todas as tasks. Um teste do desktop que precise mudar é bug, não ajuste.
- **Core sem Node** (`no-node.test.ts`). Dinheiro sempre em `D()`/`Decimal` e texto decimal canônico; `parseDecimalInput(raw, currency)` com a moeda da tabela.
- **Datas:** "hoje" vem de `todayLocalISO()`, nunca de `toISOString().slice(0, 10)`. Os ids vêm de `randomUUID` de `@sagyou/core/sync/bytes`.
- **Textos exatos:**
  - avisos: "Este lançamento só pode ser editado no PC." (existe), "Este lançamento só pode ser excluído no PC.", "Valor inválido." (existe), "O pagamento passa do valor restante.";
  - confirmações: "Excluir <nome>?" com **Excluir**/**Cancelar**, e "Excluir a tabela <nome> e todos os lançamentos dela?";
  - vazios e filtros: "Nenhum lançamento neste mês.", "Nenhum lançamento com estes filtros.", "Limpar filtros", "Buscar lançamento", "Escolha uma tabela para ver esta área.";
  - chips de filtro: "Tipo: Todos/Receitas/Gastos" e "Categoria: Todas/<cat>";
  - dívidas e pagamento: "Nova dívida", "Pagar", "Quitada em <data>", "Pagamento de dívida: <nome>";
  - seletor de tabela: "Nova tabela…", "Renomear", "Excluir", "Consolidado";
  - abas: Lançamentos, Resumo, Dívidas, Metas, Compras, Rendimentos.
- **Celular:**
  - alvos de 48 dp, cores só de `theme.ts`, componentes de `ui.tsx`;
  - confirmação por `Alert.alert` num helper `confirmDelete(title, onConfirm)` em `components/confirm.ts`;
  - `a11y.test.tsx` cobre cada aba nova e a tela `Lancamento` (entradas acrescentadas **no fim** de `SCREENS`).
- **Versões:** celular MINOR (0.8.x → 0.9.0, `versionCode` 900; conferir a `main` na Task 10). Desktop não muda.

## Decisões do construtor (da checagem do plano)

- **O core espelha o desktop, inclusive nos detalhes.**
  - `toggleItem` grava o `updatedAt` da tabela com `today` (`yyyy-MM-dd`), como hoje.
  - `createdAt` dos lançamentos novos = `now.toISOString()`.
  - Ids por `randomUUID` (v4, como o `uuid` do desktop).
  - `updateTransaction` só toca `updatedAt` quando algo mudou.
  - Cada função recebe `now` e, quando o desktop usa o dia local, também `today`.
- **Erros do core:** `{ error: 'not-found' | 'invalid-amount' | 'over-remaining' | 'invalid-name' }`.
  - O core só recusa o que o desktop recusa hoje:
    - `addDebt` com nome vazio ou valor ≤ 0;
    - `payDebt` com valor inválido, ≤ 0 ou acima do restante;
    - `addItem` com preço lixo grava `undefined`, como hoje.
  - O slice continua devolvendo `''`/`false`.
  - O celular traduz: `invalid-amount` → "Valor inválido.", `over-remaining` → "O pagamento passa do valor restante.", `not-found` → "Este item não existe mais.".
  - Nome vazio em formulário do celular desabilita o botão de salvar; não é regra do core.
- **Valores:** `payDebt`, `addDebt`, `addItem`, `addGoal` e entradas de rendimento recebem o valor **já canonizado**. O celular usa `parseAmount(raw, currency)`; o desktop passa o que já passava. `addItem.price` é `string | undefined`.
- **Perfil da tabela nova:** quem chama resolve. O slice do desktop mantém a validação de hoje e passa o id resolvido para `createTable`. O celular passa o `profileId` ativo.
- **Resumo mensal de rendimentos:** vira a função pura `syncYieldSummary(table, month, now): FinancialTable` no core (Task 2).
  - Ela faz o mesmo que o `useEffect` de `components/financial/YieldsTab.tsx` (linhas 86-127): soma o mês e cria, atualiza ou apaga `Rendimentos <Mês> <ano>` no dia 1.
  - O desktop chama `syncYieldSummary` dentro do mesmo efeito. O diálogo de duplicatas continua só no desktop.
  - O celular chama a função no mesmo `commit` de cada escrita de entrada.
  - `YieldsTab.test.tsx` passa intacto.
- **Travas do celular** (camada do celular, em `store/finance.ts`; o core não recusa):
  - `editLock(table, tx)` = a regra de hoje (`isLockedTransaction`) **mais** os resumos de rendimento (descrição que começa com `Rendimentos ` e categoria `YIELD_SUMMARY_CATEGORY`). Texto: "Este lançamento só pode ser editado no PC.", ou, no resumo, "Este lançamento vem dos rendimentos do mês.".
  - `deleteLock(table, tx)` trava:
    - `currencyTransferId`;
    - espelho ou fatura vinculada, nos dois sentidos;
    - o vínculo legado `linkedTransactionId`, nos dois sentidos;
    - o resumo de rendimento.

    Texto: "Este lançamento só pode ser excluído no PC.", ou o de rendimento.
  - Pagamento de dívida e lançamento `fromShopping` podem ser excluídos, como no desktop.
- **`store/finance.ts` do celular:** `addTransaction` e `updateTransaction` mantêm os nomes e as assinaturas `(state: MobileState, …)`, mas passam a chamar o core.
  - `TransactionPatch` ganha `source`, `counterparty` e `bankReference`.
  - Os testes atuais de `store/finance` e de `TransactionSheet` continuam valendo e ganham os campos novos.
- **Meta:** o celular também conclui (data + nota opcional) e reabre, como `onComplete`/`onRevert` do desktop: `completeGoal`/`revertGoal` no core (Task 2) e botões na Task 8.
- **`goalProgress` (Task 4):**
  - Devolve `{ effectiveBalance, actualBalance, percent, achieved, projected, overdue }`, com a fórmula de `FinancialGoalCard.tsx` 263-298.
  - Casos escritos a partir dela, com valores à mão:
    1. abaixo do alvo;
    2. alcançado no mês;
    3. alcançado só com futuros (projetado);
    4. prazo passado sem alcançar (atrasada);
    5. concluída antes do mês escolhido.
  - O resto do card (`monthsLeft`, `monthlyNeeded`…) fica inline.
  - Os 5 casos "goal progress" de `financial.test.ts` não chamam função nenhuma e ficam como estão.
- **`monthBounds`:** também em `FinanceTab.tsx` 156-158 (Task 4).
- **Pref da tabela:** `finance.lastTable.<perfil>` aceita `'all'` (Consolidado). O `TransactionSheet` só regrava a pref quando ela não é `'all'`, para quem está no Consolidado não sair dele. O (+) fica visível no Consolidado; o `quickTable` já cai na primeira tabela.
- **Sem tabela:** "Nenhuma tabela neste perfil." com o botão **Nova tabela**. O texto fixado em `a11y.test.tsx` (linha 220) muda junto, na Task 5.
- **Bloqueio:** a Task 5 testa que, com `useLockState.hidden`, as folhas abertas fecham. O `commit` recusa escrever, regra de hoje.

## Foco de Review

1. **Desktop muda de comportamento sem querer.**
   - **Esperado:** pagar dívida, excluir pagamento, marcar item, atualizar item feito, rendimento, consolidado e progresso de meta dão o mesmo resultado de antes. O `financial.test.ts` e os testes de componente do desktop passam intactos.
   - Testado nas Tasks 1-4.
2. **Dado já existente que o celular não conhecia.**
   - **Esperado:** abrir e editar tabelas com `legacyFinancialMetadata`, `details`, `audit`, `receiptFileIds`, `currencyTransferId` ou espelho de fatura não apaga nem muda esses campos. Excluir pelo celular um lançamento vinculado por transferência ou fatura é recusado.
   - Testado nas Tasks 1 e 6.
3. **Dívida e pagamento em conflito com o PC.**
   - **Esperado:** `payDebt` grava a dívida e o lançamento juntos, num único `commit`. Excluir o pagamento devolve o valor à dívida. Nada de dinheiro fica entre moedas.
   - Testado nas Tasks 2 e 8.
4. **Consolidado somando moedas diferentes.**
   - **Esperado:** nunca soma BRL com JPY. Os espelhos vinculados ficam fora dos totais.
   - Testado na Task 4.
5. **Só leitura e bloqueio.**
   - **Esperado:** desconectado, todo botão de escrita fica desabilitado. Com o app bloqueado, `commit` recusa e as folhas fecham.
   - Testado nas Tasks 5-9.

### Task 1: core — lançamentos e compras (`finance-actions`)

**Arquivos:**
- Criar `packages/core/src/finance-actions.ts`.
- Teste: `packages/core/src/__tests__/finance-actions.test.ts`.

**Interfaces (Produz):**
```ts
export type Tables = FinancialTable[]
export type ActionResult = { tables: Tables; id?: string } | { error: string }
export function addTransaction(tables, tableId, data: Omit<FinancialTransaction,'id'>, now: Date): ActionResult
export function updateTransaction(tables, tableId, txId, updates: Partial<FinancialTransaction>, now: Date): ActionResult
export function deleteTransaction(tables, tableId, txId, now: Date): ActionResult
export function addItem(tables, tableId, data: { name: string; qty: number; price?: string | number; link?: string }, now: Date): ActionResult
export function updateItem(tables, tableId, itemId, updates, now: Date): ActionResult
export function deleteItem(tables, tableId, itemId, now: Date): ActionResult
export function toggleItem(tables, tableId, itemId, now: Date, today: string): ActionResult
```

As regras são as do slice do desktop (`store/slices/financial.ts`):
- `deleteTransaction` devolve o valor à dívida e desfaz o par de transferência;
- `toggleItem` cria o gasto `fromShopping` com a data `today` e o apaga ao desmarcar;
- `updateItem` com item feito ajusta o lançamento ligado;
- `addItem` canoniza o preço;
- `updateTransaction` passa por `applyFinancialTransactionEdit` e não deixa os `details` passarem do total.

- [ ] **Passo 1: testes.** Portar um a um, com os mesmos valores, os casos de `financial.test.ts`:
  - "toggleItem financial link" (4 casos);
  - "deleteItem financial link" (2);
  - "updateItem linked transaction sync" (6);
  - "addItem price validation" (3);
  - "transaction actions" (5);
  - de "financial documentation and currency transfers": "keeps old transaction dates unknown…", "clears bank reconciliation…" e "clears the pair on deletion".

  Mais: um lançamento com `legacyFinancialMetadata` na tabela, `receiptFileIds` e `audit` sai de `updateTransaction` com esses campos intactos.
- [ ] **Passo 2:** implementar; typecheck do core.
- [ ] **Passo 3:** commit `feat(core): regras de lançamentos e compras do financeiro`; push; abrir o PR rascunho `feat(mobile): financeiro completo`; CI verde.

### Task 2: core — dívidas, metas, rendimentos e tabelas

**Arquivos:** Modificar `finance-actions.ts` e o teste.

**Interfaces (Produz):**
- `addDebt(tables, tableId, name, amount, now)`
- `payDebt(tables, tableId, debtId, amount, date, now)`: devolve `{ error: 'O pagamento passa do valor restante.' }` quando passa do restante, e `'Valor inválido.'` quando ≤ 0.
- `deleteDebt`
- `addGoal`, `updateGoal`, `deleteGoal`
- `addYieldSource`, `updateYieldSource`, `deleteYieldSource`
- `addYieldEntry`, `updateYieldEntry`, `deleteYieldEntry` (CRUD como no slice)
- `syncYieldSummary(table, month, now)`: o resumo mensal, saído do efeito do `YieldsTab.tsx`
- `completeGoal(tables, tableId, goalId, date, note, now)`, `revertGoal`
- `createTable(tables, name, currency, profileId, now)`, `renameTable`, `deleteTable`

- [ ] **Passo 1: testes.**
  - Portar "debt payments" (2 casos), "financial goal actions" (3 de CRUD) e de "financial table creation": "creates tables in the selected financial profile" e "deleteList removes the table entirely".
  - Rendimentos: um caso por função do CRUD, com o resultado lido do slice atual.
  - `syncYieldSummary` com os casos de `YieldsTab.test.tsx`: cria, atualiza e apaga o resumo do mês.
  - Meta: concluir e reabrir.
  - `payDebt` acima do restante devolve o texto exato.
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(core): regras de dívidas, metas, rendimentos e tabelas`; push; CI verde.

### Task 3: desktop chama o core (sem mudar resultado)

**Arquivos:** Modificar `apps/desktop/src/renderer/src/store/slices/financial.ts`.

- [ ] **Passo 1:** o efeito do `YieldsTab.tsx` passa a chamar `syncYieldSummary`. Cada ação coberta pelas Tasks 1-2 vira `set((s) => resultOf(coreFn(s.lists, …)))` + `_persist()`. Mantém a mesma assinatura e o mesmo retorno: id, `boolean` de `payFinancialDebt`, `''` em erro de `addFinancialDebt`. `todayLocalISO()` para `toggleItem`.
- [ ] **Passo 2:** typecheck. Nenhum teste do desktop é alterado.
- [ ] **Passo 3:** commit `refactor(desktop): slice financeiro usa as regras do core`; push; CI verde. O `financial.test.ts` passando intacto é a prova.

### Task 4: core — contas de tela (`finance-views`) e o desktop usando

**Arquivos:**
- Criar `packages/core/src/finance-views.ts`.
- Teste: `packages/core/src/__tests__/finance-views.test.ts`.
- Modificar `apps/desktop/src/renderer/src/components/financial/ConsolidatedTab.tsx` (o `byCurrency`), `FinanceTab.tsx` (cortes do mês) e `FinancialGoalCard.tsx` (corte, alcançado e projetado).

**Interfaces (Produz):**
```ts
export function monthBounds(month: string /* yyyy-MM */, today: string): { currentCutoff: string; monthEnd: string }
export function consolidatedByCurrency(tables, month, today): { currency: Currency; income: string; expense: string; current: string; projected: string }[]
export function categoryBreakdown(txs, month): { category: string; amount: string }[] // gastos, maior → menor; sem categoria = ''
export function goalProgress(goal: FinancialGoal, txs, month, today): { balance: string; percent: number; achieved: boolean; projected: boolean; overdue: boolean }
```

- [ ] **Passo 1: testes.**
  - Consolidado com BRL e JPY nunca soma as moedas, e espelho de fatura ou vínculo legado fica fora.
  - Corte do mês atual versus mês passado (regra do CLAUDE.md).
  - Categoria ordenada.
  - `goalProgress` com os 5 casos listados em "Decisões do construtor".
- [ ] **Passo 2:** implementar; trocar o cálculo inline do desktop pela chamada. Os testes de componente do desktop passam intactos.
- [ ] **Passo 3:** commit `feat(core): contas do financeiro compartilhadas`; push; CI verde.

### Task 5: celular — topo, tabelas e abas

**Arquivos:**
- Criar `apps/mobile/src/screens/finance/FinanceTop.tsx`, `screens/finance/TableSheet.tsx` e `components/confirm.ts`.
- Modificar `screens/FinanceScreen.tsx`, que vira a casca: topo + abas + conteúdo.
- Modificar `store/finance.ts`, com wrappers `applyFinance(fn)` que fazem `commit({ ...state, lists })` ou mostram o erro.
- Teste: `screens/__tests__/Finance.test.tsx` e `__tests__/a11y.test.tsx`.

**Interfaces:**
- `FinanceTop({ tableId: string | 'all', onTable, month, onMonth })`.
- Estado da casca: `tableId` lembrado em `lastTablePref`, aceitando `'all'`; `month` começa no atual; `tab: FinanceTab` (não lembrado).

- [ ] **Passo 1: testes.**
  - O seletor lista "Consolidado", as tabelas do perfil e "Nova tabela…".
  - "Nova tabela…" cria a tabela com nome e moeda no perfil ativo.
  - "Renomear" e "Excluir" (com a confirmação exata) funcionam.
  - "‹" e "›" mudam o mês, e tocar no nome volta ao atual.
  - As seis abas existem e trocam o conteúdo.
  - Em só leitura, criar, renomear e excluir ficam desabilitados.
  - Sem tabela: "Nenhuma tabela neste perfil." e **Nova tabela** (o texto antigo do `a11y.test.tsx` muda junto).
  - Com o Consolidado escolhido, salvar um gasto pelo (+) não troca a pref.
  - Com `useLockState.hidden`, uma folha aberta fecha.
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(mobile): topo do financeiro com tabelas, mês e abas`; push; CI verde.

### Task 6: celular — Lançamentos e detalhes

**Arquivos:**
- Criar `screens/finance/TransactionsTab.tsx` e `screens/finance/TransactionDetailScreen.tsx`.
- Modificar `App.tsx` (stack raiz `Lancamento: { tableId; txId }`) e `components/TransactionSheet.tsx` (campos origem, pessoa e referência na edição).
- Teste: `Finance.test.tsx`, novo `TransactionDetail.test.tsx` e `a11y`.

- [ ] **Passo 1: testes.**
  - Mês escolhido e agrupamento por dia.
  - "Buscar lançamento" sem acento e sem maiúscula.
  - Chips Tipo e Categoria; os filtros vazios mostram "Limpar filtros".
  - A tela de detalhes mostra itens de fatura, origem, pessoa, referência, criado em, conferido em e o histórico.
  - Editar grava pelo core.
  - Excluir pede "Excluir <descrição>?" e apaga.
  - Excluir um pagamento de dívida devolve o valor.
  - Um lançamento de resumo de rendimento mostra "Este lançamento vem dos rendimentos do mês." e não tem Editar nem Excluir.
  - Um item de fatura (`details`) aparece nos detalhes e sobrevive a uma edição de valor.
  - Um vinculado por transferência ou fatura mostra "Este lançamento só pode ser editado no PC.", não tem Editar, e Excluir mostra "Este lançamento só pode ser excluído no PC.".
  - No Consolidado: lista com o nome da tabela e nenhum botão de criar.
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(mobile): lançamentos com filtros, detalhes e excluir`; push; CI verde.

### Task 7: celular — Resumo e Consolidado

**Arquivos:** Criar `screens/finance/SummaryTab.tsx`. Teste: `Finance.test.tsx`.

- [ ] **Passo 1: testes.**
  - Tabela: saldo atual e projetado do mês escolhido, entradas, saídas e as barras por categoria com o valor em texto, ordenadas.
  - Consolidado: um cartão por moeda (BRL e JPY separados), sem conversão.
  - Dívidas, Metas, Compras e Rendimentos no Consolidado mostram "Escolha uma tabela para ver esta área.".
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(mobile): resumo do mês e consolidado por moeda`; push; CI verde.

### Task 8: celular — Dívidas e Metas

**Arquivos:**
- Criar `screens/finance/DebtsTab.tsx`, `GoalsTab.tsx`, `DebtSheet.tsx` (nova e pagar) e `GoalSheet.tsx`.
- Teste: `Finance.test.tsx`.

- [ ] **Passo 1: testes.**
  - "Nova dívida".
  - "Pagar" grava a dívida e o lançamento "Pagamento de dívida: <nome>" num `commit` só (o `save` é chamado uma vez).
  - Pagar acima do restante mostra o texto exato.
  - Quitada vai para o fim com "Quitada em <data>".
  - Excluir dívida mantém os pagamentos.
  - Metas: criar, editar e excluir; concluir (data + nota) e reabrir; progresso, "projetado" e atrasada, por `goalProgress`; a concluída mostra a nota.
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(mobile): dívidas e metas financeiras`; push; CI verde.

### Task 9: celular — Compras e Rendimentos

**Arquivos:**
- Criar `screens/finance/ShoppingTab.tsx`, `YieldsTab.tsx`, `ItemSheet.tsx` e `YieldSheet.tsx`.
- Teste: `Finance.test.tsx`.

- [ ] **Passo 1: testes.**
  - Marcar um item com preço cria o gasto de hoje; desmarcar o apaga. Os comprados vão para o fim.
  - Adicionar, editar e excluir item. O link abre por `Linking.openURL`, aceitando só `http:` e `https:`.
  - Rendimentos: fontes e entradas do mês, lançar entrada (gera o resumo mensal do dia 1, como no core), editar e excluir. Criar, renomear e excluir fonte.
- [ ] **Passo 2:** implementar.
- [ ] **Passo 3:** commit `feat(mobile): compras e rendimentos`; push; CI verde.

### Task 10: docs, versão, review e PR

- [ ] **Passo 1:** atualizar a documentação.
  - `CLAUDE.md`:
    - `packages/core` ganha `finance-actions`/`finance-views`;
    - o bloco do celular descreve o Financeiro e a rota `Lancamento`;
    - nova regra ⚠️ "regra de dinheiro nova vai no core, não no slice".
  - `README.md`: o app Android.
  - `GUIDE.md`: se citar o financeiro do celular.
- [ ] **Passo 2:** versão do celular MINOR (conferir a `main`).
- [ ] **Passo 3:** push; CI verde; APK pelo `mobile-apk.yml` se o Luis quiser testar.
- [ ] **Passo 4:** `/sagyou-review` (geral + UI) e `/sagyou-pr` para tirar o rascunho.
