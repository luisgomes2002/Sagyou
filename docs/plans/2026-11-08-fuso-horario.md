# Plano de implementação: Fuso horário (data explícita nas tools de MCP)

Status: approved by Luis on 2026-11-08
Spec: docs/specs/2026-11-08-fuso-horario.md
Branch: feature/fuso-horario

**Objetivo:** `create_transaction` e `add_goal_progress` recusam quando a data não vem, em vez
de gravar o "hoje" do PC.

**Arquitetura:** a regra vive no `prepare`/`apply` do renderer (`services/mcpActions.ts`),
onde as duas tools já validam a data; como o `prepare` roda antes de o main abrir o cartão,
a recusa não abre cartão. O schema em main (`mcp-write-tools.ts`) passa a marcar `date`
como obrigatória e troca a descrição, para o agente saber antes de chamar.

## Restrições Globais

- Texto da recusa (exato): `date é obrigatória (YYYY-MM-DD): use a data do usuário, que pode estar em outro fuso do PC. Se não souber, pergunte.`
- Descrição nova do parâmetro `date` nas duas tools (exata): `Data YYYY-MM-DD do usuário (obrigatória; o usuário pode estar em outro fuso do PC).`
- Data inválida mantém o texto atual: `date precisa ser uma data real no formato YYYY-MM-DD.`
- `date: ""` conta como ausente e recusa.
- Sem mudança de dados, de telas ou de `todayLocalISO()`.
- Testes: não rodar localmente (pedido do Luis); a verificação é o CI do PR (`gh pr checks` / `gh run watch`).

## Foco de Review

1. **Nenhum cartão abre sem data.** `prepareMcpAction('create_transaction', sem date)` devolve
   `ok: false` com o texto exato; como o main só estaciona o cartão depois de um `prepare`
   ok, nada chega ao PC nem ao celular. Testado na Task 1.
2. **`apply` também recusa** (um `apply` direto, sem `prepare`, não pode gravar com o hoje do
   PC). Testado na Task 1 (helper `both`, que roda as duas fases).
3. **Meta já concluída sem data** continua devolvendo `jaConcluida: true` sem gravar: o
   retorno antecipado vem antes da leitura da data, e nada é escrito, então não há dia
   errado (decisão do construtor). Testado na Task 1.
4. **Data futura continua aceita** (gasto agendado). Testado na Task 1.
5. **Dados existentes:** nenhum registro é lido ou reescrito; os testes antigos que lançavam
   sem data passam a informar uma, sem mudar o que verificam. Testado na Task 1.

### Task 1: exigir a data no renderer

**Arquivos:**
- Modificar `apps/desktop/src/renderer/src/services/mcpActions.ts`
- Teste `apps/desktop/src/renderer/src/__tests__/services/mcpActions.test.ts`

**Interfaces:** Produz `requiredDate(args: Args, key: string): string` (privada ao módulo).

- [ ] Passo 1: testes novos em `mcpActions.test.ts`:
  - `create_transaction refuses without a date and opens no card`:
    `prepareMcpAction('create_transaction', { tableId, type: 'despesa', amount: '10', description: 'Mercado' }, scope)`
    e o mesmo com `date: ''` → `toEqual({ ok: false, error: <texto exato> })`; `both(...)` idem;
    `table(mine).transactions` continua vazio.
  - `add_goal_progress refuses without a date`: meta de quantidade, `{ id, value: 1 }` →
    `{ ok: false, error: <texto exato> }`, `goal(id).entries` vazio; meta de conclusão,
    `{ id }` → a mesma recusa.
  - `add_goal_progress on a completed goal still reports jaConcluida without a date`.
  - `create_transaction accepts a future date`: `date: '2099-01-01'` → `ok: true`, `tx.date === '2099-01-01'`.
  - Testes existentes que passam a quebrar e ganham `date: '2026-10-25'`, sem mudar as
    outras asserções (conferido pelo verificador do plano):
    - ~531: `add_goal_progress { id, value: 5 }` numa meta de conclusão (espera `ok: true`);
    - ~834: `create_transaction` pelo token externo (espera `ok: true`);
    - ~931: `create_transaction` com `source`/`counterparty` (espera `ok: true`);
    - ~998: `create_transaction` com `source` de 81 caracteres (espera exatamente
      `'source excede 80 caracteres.'`; sem `date` o erro passaria a ser o da data).
    Não mudam: ~551 (meta já concluída devolve antes de ler a data), ~685 e ~693 (o valor e a
    tabela recusam antes), ~899/~941 (já têm data) e os de `details` (o helper `create` já
    inclui data).
  - **Ordem das validações (decisão do construtor):** `requiredDate` fica onde está hoje a
    leitura da data, depois de tabela, tipo, valor e descrição e antes de banco e detalhes.
    Uma chamada sem data e com outro erro de banco/detalhe recebe primeiro o erro da data.
- [ ] Passo 2: esperado no CI: FALHA, porque hoje a ausência de data cai em `todayLocalISO()`.
- [ ] Passo 3: em `mcpActions.ts`, criar `requiredDate` = `optionalDate`; se vier `undefined`
  ou `''`, `refuse(<texto exato>)`. Trocar `optionalDate(args, 'date') || todayLocalISO()`
  por `requiredDate(args, 'date')` em `addGoalProgress` (linha ~646) e `createTransaction`
  (linha ~981). Remover o import de `todayLocalISO` se ficar sem uso.
- [ ] Passo 4: esperado no CI: PASSA.
- [ ] Passo 5: commit `feat(mcp): data obrigatória em create_transaction e add_goal_progress`

### Task 2: schema e descrição em main

**Arquivos:**
- Modificar `apps/desktop/src/main/modules/agent/mcp-write-tools.ts`
- Teste `apps/desktop/src/main/__tests__/mcp-write-tools.test.ts`

**Interfaces:** Consome nada da Task 1 (os textos são literais).

- [ ] Passo 1: em `mcp-write-tools.test.ts`:
  - mudar a asserção existente para `expect(create.required).toEqual(['tableId', 'type', 'amount', 'description', 'date'])`;
  - novo `it('date is required and explained on create_transaction and add_goal_progress')`:
    para as duas tools, `properties.date.description` é a descrição exata e `required`
    contém `'date'`; para `update_transaction`, `required` continua `['tableId', 'id']`.
- [ ] Passo 2: esperado no CI: FALHA (descrição e `required` antigos).
- [ ] Passo 3: trocar `const date = text('Data YYYY-MM-DD; omita para hoje.')` pela descrição
  nova; passar `['tableId', 'type', 'amount', 'description', 'date']` em `create_transaction`
  e `['date']` em `add_goal_progress` (o `goalRef` continua opcional: id ou título).
- [ ] Passo 4: esperado no CI: PASSA.
- [ ] Passo 5: commit `feat(mcp): schema exige date nas tools de lançamento e progresso`

### Task 3: documentação, suíte e PR

**Arquivos:**
- Modificar `docs/seguranca/2026-11-04-ameacas-acesso-remoto.md` (seção 7, item 8: "Fuso:
  resolvido pela spec `2026-11-08-fuso-horario.md` — cada aparelho no seu fuso, data
  obrigatória nas tools").
- Modificar `CLAUDE.md` (parágrafo "MCP write tools": "`create_transaction` e
  `add_goal_progress` exigem `date`; o agente pode estar falando com alguém em outro fuso
  do PC") e `GUIDE.md` se ele listar as regras das tools de escrita.
- Conferir `apps/desktop/src/renderer/src/guide/content.ts`: se algum artigo diz que o
  agente usa a data de hoje, ajustar (hoje não diz; conferido no plano).

- [ ] Passo 1: atualizar os documentos acima.
- [ ] Passo 2: commit `docs(fuso-horario): data obrigatória nas tools de MCP`.
- [ ] Passo 3: push da branch e PR (estágio 5); acompanhar `gh pr checks` até verde.
- [ ] Passo 4: verificação no app: não há tela; a verificação manual é pedir a um Claude do
  Fleet "lança 10 reais no mercado" sem data e ver a recusa, sem cartão.
