# MCP: detalhes e dados bancários nas transações

Status: draft
Branch: feature/mcp-transacao-detalhes

## Por quê

Luis quer colar extratos e faturas num agente (Claude Code, Codex, OpenCode) e receber o financeiro preenchido como ele mesmo faria à mão. Hoje o `sagyou-mcp` lança e edita transações só com tipo, valor, descrição, data e categoria. O detalhamento das faturas fica de fora (ex.: os 24 itens da fatura C6 de 2026-08-05), e também origem, contraparte e referência bancária. Mesmo depois do agente, Luis ainda precisa abrir cada transação no app e redigitar tudo.

## Objetivos

- `create_transaction` e `update_transaction` passam a aceitar:
  - `source` (origem: banco, cartão ou app);
  - `counterparty` (contraparte);
  - `bankReference` (ID bancário/Pix);
  - `details` (itens da transação: descrição, valor, categoria e data da compra).
- Valem as mesmas regras do app: a soma dos detalhes não passa do valor da transação, toda edição entra na auditoria e mudar a origem, a contraparte ou a referência desfaz a conciliação.
- O cartão de aprovação mostra o que vai ser gravado além do valor: origem e quantos detalhes, com quanto somam.

## Fora do escopo

- **Comprovantes** (`receiptFileIds`): continuam manuais (decisão de Luis).
- **Transferência entre moedas** (`currencyTransferId`, taxa): continua manual (decisão de Luis).
- **Vincular um detalhe a uma transação de outra tabela** (`linkedTransactionId` do detalhe, como o detalhe "Claude" da fatura Nubank ligado à transação da tabela Murasaki Languages). O MCP não cria nem remove esse vínculo. Ele só o preserva (veja Comportamento).
- Marcar ou desmarcar uma transação como conciliada (`reconciledAt`).
- Remover sugestões salvas de origem ou contraparte.
- Mudanças nas ferramentas de leitura: `read_financial_data` já devolve `details`, `source`, `counterparty` e `bankReference`.

## Decisões (de Luis)

1. Comprovantes e transferências entre moedas ficam de fora; Luis faz no app.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **`details` substitui a lista inteira**, e `[]` limpa, igual a `tags` e `links` nas outras ferramentas. Para manter um detalhe existente, o agente manda o `id` dele (lido em `read_financial_data`). Esse detalhe fica com o mesmo `id` e o mesmo `linkedTransactionId`. Um item sem `id` ganha um novo. Um `id` que não é desta transação é recusado. Um detalhe vinculado que fica fora da lista perde o vínculo, como ao excluí-lo no app.
- **A soma dos detalhes pode ficar abaixo do valor** (o app mostra "Falta detalhar R$ X"), mas nunca acima. Se passar, a escrita é recusada. O app hoje descarta os detalhes calado (`addTransaction`) ou ignora a edição inteira (`updateTransaction`); o MCP recusa antes, com mensagem.
- **Origem e contraparte entram nas sugestões do perfil** (`addFinancialSource`, `addFinancialCounterparty`), como acontece ao salvar no painel da transação. Assim aparecem no autocompletar do app.
- **Categoria de um detalhe não vira categoria personalizada** do perfil, igual à categoria da transação no `create_transaction` de hoje.
- **O cartão mostra a contagem e a soma dos detalhes, não a lista.** O cartão do Fleet é uma linha de texto. Uma fatura de 24 itens não cabe ali de forma legível, e os itens podem ser conferidos no app depois.
- Nenhuma ferramenta nova: as duas que existem ganham campos, e as duas já pedem cartão.

## Comportamento

**Campos novos** (todos opcionais nas duas ferramentas):

| Campo | Limite (depois de `trim()`) | `create_transaction` | `update_transaction` |
| --- | --- | --- | --- |
| `source` | 80 | vazio = não grava | `""` limpa |
| `counterparty` | 120 | vazio = não grava | `""` limpa |
| `bankReference` | 120 | vazio = não grava | `""` limpa |
| `details` | até 200 itens | `[]` = sem detalhes | substitui a lista; `[]` limpa |

Cada item de `details`:
- `description` obrigatória, até 300 caracteres;
- `amount` obrigatório, nas mesmas regras de `amount` da transação (`parseMcpMoney`: positivo e sem separador de milhar);
- `category` opcional, até 60 caracteres;
- `date` opcional, data real `YYYY-MM-DD` (data da compra; a data da transação continua sendo a contábil);
- `id` opcional, só em `update_transaction`, para manter um detalhe existente.

Qualquer outra chave no item é recusada.

**Recusas** (`{ ok: false, error }`; nada é gravado, e passar do limite é erro, nunca corte):
- Item sem descrição: `details[3].description é obrigatório.` (índice começa em 0)
- Valor inválido: `details[3].amount precisa ser um valor positivo sem separador de milhar (ex.: 1500.50 ou 1500,50).`
- Data inválida: `details[3].date precisa ser uma data real no formato YYYY-MM-DD.`
- Chave desconhecida: `details[3] tem o campo desconhecido "foo".`
- `details` que não é lista: `details precisa ser uma lista.`
- Mais de 200 itens: `details aceita no máximo 200 itens.`
- `id` repetido na lista: `details[5].id repete outro item da lista.`
- `id` que não é desta transação: `details[2].id não é um detalhe desta transação.`
- Soma acima do valor (comparando com o valor novo, se `amount` vier na mesma chamada): `Os detalhes somam R$ 812,00, acima do valor da transação (R$ 797,48).`
- `update_transaction` com só campos novos é uma edição válida. "Nada para alterar." continua valendo quando nenhum campo veio.

**Gravação:**
- Valores dos detalhes guardados como decimal string de 2 casas, como `amount`.
- `create_transaction` grava tudo numa só chamada de `addTransaction`.
- `update_transaction` passa por `updateTransaction` → `applyFinancialTransactionEdit`, então a auditoria registra `source`, `counterparty`, `bankReference` e `details`. Mudar origem, contraparte ou referência limpa `reconciledAt` (regra existente); mudar só os detalhes não limpa.
- Transação de dívida continua recusada ("Esta transação pertence a uma dívida; altere-a no Sagyou.").

**Resumo do cartão:** o resumo atual com estes acréscimos, nesta ordem, só quando o campo veio:
- ` · origem C6 Bank`
- ` · contraparte Kokusaikaihatsu Co.. Ltd.`
- ` · ref. #2416053303`
- ` · 24 detalhes somando R$ 797,48`. Se faltar valor a detalhar, entra também ` (falta detalhar R$ 12,00)`; com um item só, fica ` · 1 detalhe somando R$ 118,38`.
- `details: []` aparece como ` · sem detalhes`.
- Em `update_transaction`, `""` aparece como ` · origem removida`, ` · contraparte removida` e ` · ref. removida`.

Exemplo: `Lançar despesa de R$ 797,48 em Brasil Pessoal — C6 Bank Fatura — 2026-08-05 · origem C6 Bank · 24 detalhes somando R$ 797,48`

## Dados

Sem mudança de dados. `source`, `counterparty`, `bankReference` e `details` já existem em `FinancialTransaction`, já são persistidos (SQLite via `persistAll`), já entram no backup e já são normalizados no load/import (`normalizeTransactionDetails`). As sugestões de origem e contraparte usam os campos `savedSources` e `savedCounterparties` do perfil, que também já existem.

## Telas

Nenhuma tela nova. O cartão de aprovação MCP no Fleet (`AttentionPanel`) mostra o resumo estendido. Os detalhes e os dados bancários gravados aparecem no painel e na lista de detalhes da transação, que já existem.

## Perguntas em aberto

(nenhuma)
