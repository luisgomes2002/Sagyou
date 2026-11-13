# Celular: financeiro completo

Status: approved by Luis on 2026-11-10
Branch: feature/mobile-financeiro
Task: "Reformular as telas do app mobile e aproximar do desktop" (sprint "Mobile 2"), item 2 (Financeiro completo).

## Por quê

Hoje a aba Finanças do celular faz pouco:
- tem uma tabela por vez, o saldo atual e as entradas e saídas **só do mês corrente**;
- tem a lista desse mês e permite criar ou editar valor, data, categoria e descrição.

Não dá para:
- ver outro mês nem filtrar;
- excluir um lançamento;
- ver os detalhes de um lançamento;
- ver resumo por categoria nem o consolidado das tabelas;
- mexer em dívidas, metas financeiras, lista de compras ou rendimentos.

Tudo isso existe no desktop.

## Objetivos

1. O celular faz no financeiro **o mesmo que o desktop**, com as mesmas regras: lançamentos, resumo, consolidado, dívidas, metas, compras, rendimentos e tabelas.
2. As regras de negócio que hoje vivem no store do desktop passam para `packages/core`. Os dois apps chamam as mesmas funções, e um pagamento de dívida, um item de compra ou um rendimento gravado no celular fica idêntico ao gravado no PC.
3. Navegação simples numa tela de celular: tabela e mês no topo, seções numa fileira de abas.

## Fora do escopo

- Comprovantes (anexos de arquivo): o celular não tem a biblioteca de arquivos.
- Vincular ou desvincular lançamentos:
  - transferência entre moedas (`currencyTransferId`);
  - espelho de fatura (`details[].linkedTransactionId`);
  - vínculo legado (`linkedTransactionId`).

  Esses lançamentos continuam **só leitura** no celular, como hoje, mas agora com detalhes visíveis.
- Conversão de moeda no consolidado. Cada moeda fica separada, sem o equivalente em BRL que o desktop busca na internet.
- Exportar para Excel e marcar como conferido (conciliação bancária).
- Gráficos de evolução do saldo.
- Criar, renomear ou excluir perfil financeiro e gerenciar categorias próprias, origens e pessoas salvas. Continua no PC. O celular troca de perfil em Ajustes, como hoje.

## Decisões (de Luis, 2026-11-10)

- **Escopo:** lançamentos completos, resumo e consolidado, dívidas e metas financeiras, listas de compras e rendimentos.
- **Navegação:**
  - no topo, o seletor de Tabela, que inclui "Consolidado", e o mês com setas;
  - abaixo, uma fileira de abas rolável: Lançamentos, Resumo, Dívidas, Metas, Compras, Rendimentos.
- **Escrita igual ao desktop:** o celular cria, edita e exclui lançamentos, dívidas, metas, itens de compra, fontes e entradas de rendimento, e tabelas.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Regras no core.** Novo módulo `packages/core/src/finance-actions.ts`, puro, que recebe e devolve a lista de tabelas, com as operações do slice financeiro do desktop:
  - `addTransaction`, `updateTransaction`, `deleteTransaction`;
  - `addItem`, `updateItem`, `deleteItem`, `toggleItem`;
  - `addDebt`, `payDebt`, `deleteDebt`;
  - `addGoal`, `updateGoal`, `deleteGoal`;
  - `addYieldSource`, `updateYieldSource`, `deleteYieldSource`;
  - `addYieldEntry`, `updateYieldEntry`, `deleteYieldEntry`;
  - `createTable`, `renameTable`, `deleteTable`.

  O slice do desktop passa a chamá-las sem mudar comportamento. Cada regra é coberta por um teste no core que reproduz o resultado de hoje do desktop.
- **Lançamentos vinculados** (transferência entre moedas, espelho de fatura, vínculo legado) continuam travados no celular: abrem só os detalhes, com o aviso "Este lançamento só pode ser editado no PC.".
  - Pagamento de dívida também não se edita, como no desktop.
  - Pagamento de dívida pode ser **excluído**, e devolve o valor à dívida (regra do desktop).
  - Os vinculados por transferência ou fatura não se excluem no celular: "Este lançamento só pode ser excluído no PC.".
- **Excluir** pede confirmação ("Excluir <nome>?" com **Excluir** e **Cancelar**), como no desktop. Não há Desfazer.
- **O mês escolhido** vale para todas as abas: Lançamentos, Resumo e os progressos que dependem de mês. Não é lembrado entre aberturas: o app abre no mês atual. A tabela escolhida continua lembrada por perfil (`finance.lastTable.<perfil>`, já existe).
- **Consolidado:**
  - mostra, por moeda, o saldo atual e as entradas e saídas do mês, somando só as tabelas daquela moeda;
  - lista os lançamentos de todas as tabelas, com o nome da tabela;
  - exclui espelhos vinculados dos totais, como o desktop;
  - é só leitura: criar lançamento pede uma tabela. Dívidas, Metas, Compras e Rendimentos mostram "Escolha uma tabela para ver esta área.".
- **Resumo do mês:**
  - saldo atual (até hoje) e saldo projetado (até o fim do mês escolhido, com os futuros já registrados), com as mesmas regras do desktop (CLAUDE.md, "The selected financial month caps both balances");
  - entradas, saídas e uma barra por categoria de gasto, ordenada do maior para o menor;
  - as barras são só visuais; o valor aparece em texto.
- **Tabelas:**
  - criar tabela (nome e moeda: BRL, USD ou JPY) dentro do perfil ativo;
  - renomear;
  - excluir, com confirmação "Excluir a tabela <nome> e todos os lançamentos dela?";
  - mudar a moeda de uma tabela continua só no PC.

## Comportamento

### Topo e navegação

- **Seletor de tabela:** "Consolidado" e as tabelas do perfil ativo, mais "Nova tabela…". O menu ⋯ da tabela tem "Renomear" e "Excluir".
- **Mês:** "‹ novembro de 2026 ›". Tocar no nome do mês volta ao mês atual.
- **Abas:** Lançamentos, Resumo, Dívidas, Metas, Compras, Rendimentos, numa fileira de chips com rolagem horizontal e alvo de 48 dp. A aba escolhida também não é lembrada.
- O (+) da aba continua abrindo o Criar rápido (Gasto/Receita na última tabela usada), como hoje.

### Lançamentos

- **Lista do mês escolhido, agrupada por dia**, como hoje.
- **Busca por descrição:** campo "Buscar lançamento", sem diferenciar acento nem maiúscula.
- **Filtros por chips:** "Tipo: Todos/Receitas/Gastos" e "Categoria: Todas/<categoria>". As categorias oferecidas são as usadas no mês.
- **Tocar num lançamento abre os detalhes:**
  - valor, tipo, data, categoria e descrição;
  - itens de fatura (`details`), origem, pessoa e referência do banco;
  - criado em, conferido em, e o histórico de alterações (`audit`) resumido.

  Botões: **Editar** (o formulário de hoje, mais os campos origem, pessoa e referência) e **Excluir**. Lançamento travado não mostra Editar e mostra o aviso.
- **Vazio:** "Nenhum lançamento neste mês." Com filtros e nada passando: "Nenhum lançamento com estes filtros." e o botão "Limpar filtros".

### Dívidas

- **Lista das dívidas da tabela:** nome, valor restante, valor original e uma barra de progresso. Quitadas ficam no fim, com "Quitada em <data>".
- **"Nova dívida":** nome e valor.
- **"Pagar":** valor (até o restante) e data. Gera o lançamento "Pagamento de dívida: <nome>" na tabela e reduz o restante, com a mesma regra do desktop (`payDebt`). Valor acima do restante: "O pagamento passa do valor restante.".
- **"Excluir dívida":** os pagamentos continuam como lançamentos comuns (regra do desktop).

### Metas financeiras

- **Lista com nome, valor alvo, mês e ano alvo e o progresso**, com a regra do desktop: o progresso do mês escolhido, limitado ao prazo, e "projetado" quando só os futuros alcançam.
- Criar, editar e excluir a meta. Concluída mostra a nota de conclusão.

### Compras

- **Itens da tabela:** nome, quantidade × preço = total e link (abre no navegador).
- **Marcar como comprado** usa a regra do desktop:
  - com preço, cria o gasto "<nome>" de hoje (`fromShopping`);
  - desmarcar apaga esse gasto.
- Adicionar, editar e excluir item. Os comprados ficam no fim.

### Rendimentos

- **Fontes da tabela e, no mês escolhido, as entradas de cada fonte** (data e valor).
- Lançar, editar e excluir entrada; criar, renomear e excluir fonte. Tudo com a mesma regra do desktop, inclusive o lançamento de resumo mensal gerado no dia 1 (`yieldSummary`).

### Erros e só leitura

- Valor inválido: "Valor inválido." (já existe).
- Modo só leitura (celular desconectado): nada se escreve. Botões de criar, editar, excluir, pagar e marcar ficam desabilitados.
- `commit()` já recusa escrever com o app bloqueado.

## Dados

Sem mudança de formato. Todas as escritas usam os campos que já existem e que o sync já versiona:
- `financial_table`, `transaction`, `financial_debt`, `shopping_item`, `financial_goal`, `yield_source`, `yield_entry`;
- valores em texto decimal, via `parseDecimalInput` com a moeda da tabela.

O celular continua sem SQLite próprio para isso: grava por `commit` e `RecordRepo`. Nenhuma pref nova além de `finance.lastTable.<perfil>`, que já existe.

⚠️ Ao mover as regras para o core, o desktop **não pode** mudar nenhum resultado. Os testes do slice financeiro do desktop continuam passando sem alteração.

## Telas

Celular, com o design system (`theme.ts`, `ui.tsx`), alvos de 48 dp, valores com `formatCurrency` da moeda da tabela e cores só do tema (entrada verde, saída vermelha):

- **Finanças:**
  - topo com Tabela e mês, e a fileira de abas;
  - conteúdo da aba escolhida;
  - folhas (`BottomSheet`) para criar e editar;
  - tela de detalhes do lançamento (stack raiz `Lancamento`, `{ tableId, txId }`).
- `a11y.test.tsx` cobre cada aba e a tela de detalhes.

Versões:
- celular: MINOR;
- desktop: não muda (as regras mudam de lugar, o comportamento não). Se algum resultado mudar, é bug.

## Perguntas em aberto

(nenhuma)
