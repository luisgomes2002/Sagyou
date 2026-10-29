# Plano de implementação: MCP — detalhes e dados bancários nas transações

Status: entregue no PR #16 (o status não chegou a ser marcado como aprovado antes do merge)
Spec: docs/specs/2026-10-26-mcp-transacao-detalhes.md
Branch: feature/mcp-transacao-detalhes

**Objetivo:** `create_transaction` e `update_transaction` passam a gravar `source`, `counterparty`, `bankReference` e `details`, com as regras do app.

**Arquitetura:** o main só ganha os campos novos no `inputSchema` das duas ferramentas (`mcp-write-tools.ts`). A fila, a classificação de cartão e o canal `store:mcp:action` não mudam. A validação e a gravação ficam no renderer (`services/mcpActions.ts`), nas fases `prepare`/`apply` que já existem, e usam as ações `addTransaction`, `updateTransaction`, `addFinancialSource` e `addFinancialCounterparty` do slice.

## Restrições Globais

- Sem mudança de dados: nenhum campo, tabela, migração ou formato de backup novo. Nada muda em `store/normalization.ts` nem em `main/store.ts`.
- `src/main` nunca importa de `src/renderer`. A lista de nomes em `mcp-write-types.ts` e `types/mcp-actions.ts` não muda, porque nenhuma ferramenta é nova.
- As duas ferramentas continuam em `MCP_APPROVAL_REQUIRED`, e `MCP_DENIAL_LABEL` não muda.
- Limites novos em `LIMITS` (`mcpActions.ts`): `transactionSource: 80`, `counterparty: 120`, `bankReference: 120`, `details: 200`. Já existentes e reaproveitados: `transactionDescription: 300` para a descrição do detalhe e `category: 60` para a categoria do detalhe.
- Dinheiro do detalhe: `parseMcpMoney`; a soma é feita com `Decimal`, nunca com `number`.
- Datas: `isCalendarDate`.
- Textos de erro e de resumo: exatamente os da spec, seção Comportamento.
- `id` de detalhe novo: `uuidv4()`.
- Ordem dos detalhes: a mesma da lista recebida.

## Foco de Review

1. **Soma dos detalhes acima do valor gravada em silêncio.** O slice descarta os detalhes (`addTransaction`) ou ignora a edição inteira (`updateTransaction`) sem avisar. O MCP precisa recusar no `prepare` com a mensagem da spec, comparando com o `amount` novo quando ele vem junto. Testado nas Tasks 3 e 4.
2. **Vínculo de detalhe perdido sem querer.** Um detalhe mantido pelo `id` conserva `linkedTransactionId`; um `id` estranho é recusado; o agente nunca consegue criar `linkedTransactionId`, porque a chave é desconhecida no item. Testado na Task 4.
3. **Dados existentes intactos.**
   - Editar só os detalhes não limpa `reconciledAt`; editar a origem limpa.
   - A auditoria registra `details`.
   - Uma transação com detalhes, editada só na descrição, mantém os detalhes como estão.

   Testado nas Tasks 2 e 4.
4. **Vazamento entre perfis.** Origem e contraparte vão para as sugestões do perfil da sessão, nunca para o perfil ativo do app. Testado na Task 2.
5. **Escrita parcial.** Uma recusa em qualquer item (o 24º de 24, por exemplo) não grava nada: nem a transação, nem os dados bancários, nem as sugestões. Testado nas Tasks 2 e 3.

### Task 1: Schema dos campos novos no main

**Arquivos:** Modificar `src/main/modules/agent/mcp-write-tools.ts`. Teste `src/main/__tests__/mcp-write-tools.test.ts`.
**Interfaces:** Produz o `inputSchema` de `create_transaction` e `update_transaction` com `source`, `counterparty`, `bankReference` (`text(...)`) e `details`:
`{ type: 'array', maxItems: 200, items: { type: 'object', properties: { id?, description, amount, category, date }, required: ['description', 'amount'], additionalProperties: false } }`.
`id` só aparece no item do `update_transaction`. Constantes novas ao lado de `amount`/`date`: `bankFields` e `transactionDetails(withId: boolean)`.
- [ ] Passo 1: teste `transaction tools expose bank fields and details`:
  - as duas ferramentas têm `source`, `counterparty`, `bankReference` e `details` em `inputSchema.properties`;
  - `details.items.required` é `['description', 'amount']` e `details.items.additionalProperties === false`;
  - `'id' in` os itens de `update_transaction` e não nos de `create_transaction`;
  - `required` das ferramentas continua igual ao de hoje.
- [ ] Passo 2: `npx vitest run src/main/__tests__/mcp-write-tools.test.ts`. Esperado: FALHA, porque `details` não existe no schema.
- [ ] Passo 3: adicione as constantes e os campos. A descrição de `details` é `'Itens da transação; substitui a lista inteira, [] limpa. A soma não pode passar do valor.'`; na de `update_transaction`, acrescente `' Mande o id de um detalhe existente para mantê-lo.'`. As descrições das ferramentas não mudam.
- [ ] Passo 4: rode de novo. Esperado: PASSA. Rode também `npm run typecheck`.
- [ ] Passo 5: commit `feat(mcp): schema de detalhes e dados bancários nas transações`

### Task 2: Origem, contraparte e referência bancária

**Arquivos:** Modificar `src/renderer/src/services/mcpActions.ts`. Teste `src/renderer/src/__tests__/services/mcpActions.test.ts` (bloco novo `describe('MCP transaction bank fields')`, reaproveitando `resetStore`, `both` e o `seedTables` do bloco financeiro, que sobe para o escopo do arquivo).
**Interfaces:**
- Produz `readBankFields(args: Args, phase: 'create' | 'update'): BankFields`, com `type BankFields = Partial<Pick<FinancialTransaction, 'source' | 'counterparty' | 'bankReference'>>`. Em `update`, `""` vira `undefined` com a chave presente, para que `applyFinancialTransactionEdit` registre a remoção. Em `create`, `""` é omitido.
- Produz `bankResumo(fields: BankFields, args: Args): string`, que monta ` · origem X` / ` · origem removida` etc., na ordem da spec.
- [ ] Passo 1: testes (todos com `both` ou com `prepare` + `apply`):
  - `create_transaction` com `source: 'C6 Bank'`, `counterparty: 'Mercado X'`, `bankReference: '#123'` grava os três, e o resumo termina com ` · origem C6 Bank · contraparte Mercado X · ref. #123`;
  - depois disso, `savedSources` do perfil **da sessão** contém `'C6 Bank'` e `savedCounterparties` contém `'Mercado X'`. Com uma sessão no perfil `Empresa` enquanto o perfil ativo do app é o padrão, a sugestão vai para `Empresa`;
  - `update_transaction` com só `source: 'Wise'` numa transação com `reconciledAt` grava, limpa `reconciledAt`, e o último `audit` tem `field: 'source'`;
  - `update_transaction` com `counterparty: ''` remove a contraparte, e o resumo contém ` · contraparte removida`;
  - `source` de 81 caracteres → `{ ok: false, error: 'source excede 80 caracteres.' }`, e nem a transação nem `savedSources` mudam;
  - `update_transaction` sem nenhum campo continua `'Nada para alterar.'`.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/services/mcpActions.test.ts`. Esperado: FALHA, porque os campos são ignorados.
- [ ] Passo 3: em `createTransaction` e `updateTransaction`:
  - chame `readBankFields` antes de montar o resumo e concatene `bankResumo`;
  - no `apply`, grave pelos mesmos `addTransaction`/`updateTransaction`;
  - depois disso, chame `store.addFinancialSource(scope.financialProfileId, …)` e `addFinancialCounterparty` só para valores não vazios.
- [ ] Passo 4: rode de novo. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): origem, contraparte e referência bancária nas transações`

### Task 3: Detalhes em `create_transaction`

**Arquivos:** Modificar `src/renderer/src/services/mcpActions.ts`. Teste `src/renderer/src/__tests__/services/mcpActions.test.ts` (bloco novo `describe('MCP transaction details')`).
**Interfaces:**
- Produz `readDetails(args: Args, existing: FinancialTransactionDetail[] | null): FinancialTransactionDetail[] | undefined`:
  - `undefined` quando `details` está ausente;
  - `existing === null` significa criação, e então `id` no item é chave desconhecida;
  - toda recusa usa os textos da spec, com o índice do item.
- Produz `detailsResumo(details: FinancialTransactionDetail[], total: string, currency: Currency): string`, que monta ` · N detalhes somando X`, ` (falta detalhar Y)` e ` · sem detalhes`.
- Produz `refuseDetailsOverTotal(details, total, currency)`, que lança `Os detalhes somam X, acima do valor da transação (Y).`
- [ ] Passo 1: testes:
  - fatura com 3 itens (`'Netflix' 44,90 Assinaturas 2026-07-05`, `'Sushi' '91' Lazer`, `'Juros' 1.03`) e `amount: '136.93'`:
    - grava `details` com `amount` `'44.9'`, `'91'` e `'1.03'`, cada um com `id` uuid e na ordem recebida;
    - o resumo termina com ` · 3 detalhes somando R$ 136,93`;
  - com `amount: '150'`, o resumo termina com ` · 3 detalhes somando R$ 136,93 (falta detalhar R$ 13,07)`;
  - um item só → ` · 1 detalhe somando …`;
  - soma 812 com `amount: '797.48'` → `{ ok: false, error: 'Os detalhes somam R$ 812,00, acima do valor da transação (R$ 797,48).' }`, e `table.transactions` continua vazia;
  - os cinco erros de item (descrição vazia, `amount: '1.500'`, `date: '2026-02-30'`, chave `foo`, `id` na criação) com o texto exato e o índice correto, o 4º item inválido com os 3 primeiros bons, e nada gravado;
  - 201 itens → `'details aceita no máximo 200 itens.'`;
  - `details` que não é array → `'details precisa ser uma lista.'` (decisão do construtor: a spec não fixava esse texto).
- [ ] Passo 2: rode o arquivo de teste. Esperado: FALHA, porque `details` é ignorado.
- [ ] Passo 3: implemente `readDetails` reaproveitando `optionalText`, `parseMcpMoney` e `isCalendarDate` sobre o objeto do item. As mensagens são prefixadas com `details[i].`, por uma variante `readDetailText(item, i, key, max)`, porque `optionalText` usa a chave pura na mensagem. Em `createTransaction`, valide e recuse a soma antes do `if (phase === 'prepare')`, e passe `details` a `addTransaction` só quando houver itens.
- [ ] Passo 4: rode de novo. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): detalhes ao lançar transação`

### Task 4: Detalhes em `update_transaction`

**Arquivos:** Modificar `src/renderer/src/services/mcpActions.ts`. Teste no mesmo bloco `describe('MCP transaction details')`.
**Interfaces:** Consome `readDetails(args, transaction.details ?? [])`, `detailsResumo` e `refuseDetailsOverTotal` da Task 3. A checagem de soma que já existe em `updateTransaction`, para quando só o valor diminui, passa a usar `refuseDetailsOverTotal`. A mensagem antiga (`'Os detalhes desta transação somam …; ajuste-os antes de reduzir o valor.'`) continua quando `details` não veio na chamada, para não quebrar o teste existente `update_transaction refuses an amount below the sum of its details`.
- [ ] Passo 1: testes, sobre uma transação semeada com dois detalhes, `A` (com `linkedTransactionId: 'tx-murasaki'`) e `B`:
  - `details: [{ id: A.id, description: 'Claude', amount: '118.38' }, { description: 'Novo', amount: '10' }]`:
    - `A` mantém `id` e `linkedTransactionId`;
    - `B` sai;
    - `Novo` ganha um uuid;
    - o último `audit` tem `field: 'details'`;
    - `reconciledAt` continua definido;
  - `details: []` limpa, e o resumo contém ` · sem detalhes`;
  - `id: 'nao-existe'` → `'details[0].id não é um detalhe desta transação.'`;
  - `id` de `A` repetido → `'details[1].id repete outro item da lista.'`;
  - `amount: '50'` junto com detalhes que somam 60 → a recusa da spec com `R$ 60,00` e `R$ 50,00`, e nada muda;
  - `amount: '200'` junto com detalhes que somam 150 (o valor velho era 100) → grava os dois;
  - só `description: 'X'` numa transação com detalhes → os detalhes ficam iguais (`toEqual`);
  - transação de dívida com `details` → `DEBT_REFUSAL`.
- [ ] Passo 2: rode o arquivo de teste. Esperado: FALHA.
- [ ] Passo 3: em `updateTransaction`:
  - leia `details` com `readDetails(args, transaction.details ?? [])`, que preserva `linkedTransactionId` do existente pelo `id` (cópia do item gravado, com os campos enviados por cima);
  - compare a soma com `updates.amount ?? transaction.amount`;
  - coloque `updates.details` e concatene `detailsResumo`.
- [ ] Passo 4: rode de novo. Esperado: PASSA. Rode `npm run typecheck` e `npm run lint`.
- [ ] Passo 5: commit `feat(mcp): editar detalhes de transação`

### Task 5: Verificação final, docs e PR

**Arquivos:** Modificar `CLAUDE.md` e `GUIDE.md`, só se descrevem os campos das ferramentas financeiras do MCP (hoje não descrevem; nesse caso, nada muda). `README.md`: uma linha na seção do MCP dizendo que o agente lança detalhes de fatura, origem, contraparte e referência.
- [ ] Passo 1: `npm run typecheck`, `npm run lint` e `npm test`. Esperado: tudo verde.
- [ ] Passo 2: verificação no app (`npm run dev`), numa sessão de agente do Fleet:
  - lance uma fatura de teste com 3 detalhes e origem;
  - confira o resumo no cartão;
  - aprove e confira no painel da transação: os detalhes, "Falta detalhar", a origem no autocompletar e o histórico de auditoria;
  - edite os detalhes mantendo um `id`;
  - negue um cartão e confirme que nada mudou.
- [ ] Passo 3: `/sagyou-review`, depois `/sagyou-pr`. O PR diz "Sem mudança de formato de dados persistidos."
