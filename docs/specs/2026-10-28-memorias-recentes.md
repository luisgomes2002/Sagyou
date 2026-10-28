# Memórias recentes e handoffs localizáveis

Status: approved by Luis on 2026-10-28
Branch: feature/memorias-recentes

## Por quê

Ao voltar a um assunto ("e o plano da opção B?"), o agente procura com `search_memory` e não acha nada. O registro existe, mas é um handoff com o título "Última sessão de terminal", o pedido "Sessão interativa" e nenhum assunto. Nenhum termo de busca casa com ele, e o MCP não tem como listar memórias sem um termo. O agente então responde do zero, ignorando o que já foi feito.

Tasks: "Memórias: listar registros recentes sem termo de busca", "Handoff de terminal: registrar assunto, decisões e pendências quando disponíveis" e "IA: recuperar memórias por assunto e depois por handoffs recentes".

## Objetivos

1. Ferramenta MCP somente leitura `list_recent_memories`: lista memórias por data, sem termo, com filtros de tipo, status e período, e com paginação.
2. O handoff de fim de sessão passa a registrar assunto, decisões, ações feitas pelo MCP e pendências, **só a partir de fontes confiáveis**. Sem fonte, ele diz que é preciso consultar a run.
3. O fluxo de recuperação da IA (briefing e descrições das ferramentas) passa a ser: buscar por assunto → se não achar, listar handoffs recentes → abrir candidatos com `read_memory` → tratar como evidência histórica → propor `save_memory` para decisões duráveis.

## Fora do escopo

- Paginação da tela de memórias no app (task "Adicionar paginação na memória", sprint Optimization). Aqui, só a ferramenta MCP pagina.
- Salvar a conversa do terminal ou o log no handoff.
- Gerar resumo do terminal por modelo ou heurística sobre a saída do PTY.
- Mudar `search_memory`, `read_memory` ou a regra de acesso entre projetos que eles já têm.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Escopo de `list_recent_memories` igual ao de `search_memory`.** Sem `projectId`, lista o projeto da sessão mais as globais. Com `projectId`, lista aquele projeto mais as globais, porque `search_memory` e `read_memory` já permitem ler qualquer projeto. Uma sessão sem projeto lista todos, como `search_memory`. Nunca devolve o corpo completo.
- **Continua existindo um handoff por projeto** (`handoff:<projectId>`, sobrescrito a cada sessão). Guardar histórico de handoffs mudaria a quantidade de dados persistidos e o comportamento do resto do app. "Vários handoffs" são o do projeto, o global e os de outros projetos.
- **Fontes do handoff** (nada é inferido do diff, do log ou de alterações não aplicadas):
  - **Assunto:** o pedido da sessão, quando não é a sessão em branco. Senão, o resumo da primeira ação feita pelo MCP na sessão. Senão, fica "Sessão interativa".
  - **Decisões:** as decisões que o chat passou ao abrir a sessão (`decisoes`) e os títulos das memórias do tipo `decisao` salvas pelo MCP nessa run.
  - **Ações pelo MCP:** os resumos (o mesmo texto do cartão) das escritas aplicadas na run, até 12.
  - **Pendências:** tasks em que a sessão iniciou o cronômetro e que ela não concluiu.
- **Título:** `Sessão de terminal: <assunto>` (até 120 caracteres), ou `Última sessão de terminal` quando não há assunto.
- **Status `not_applied`:** a lista de arquivos ganha o rótulo "não aplicados ao projeto", para ninguém tomar uma alteração recusada como decisão.
- **Briefing com fallback:** quando a busca pelo pedido não acha memórias, o briefing inclui o handoff do projeto (e o global) como contexto histórico, com o aviso de conteúdo não confiável que já existe.

## Comportamento

### `list_recent_memories`

Entrada (todos opcionais):

| Campo | Regra |
| --- | --- |
| `projectId` | como em `search_memory` |
| `type` | um de `decisao`, `tradeoff`, `gotcha`, `fato`, `handoff`, `planejamento` |
| `status` | `active` (padrão), `archived` ou `all` |
| `since` / `until` | data `YYYY-MM-DD`, inclusiva, comparada com `updatedAt` no fuso local |
| `limit` | 1 a 50, padrão 20 |
| `offset` | ≥ 0, padrão 0 |

Ordem: `updatedAt` decrescente. Fixadas não sobem para o topo, porque a pergunta é "o que é recente".

Saída: `{ total, offset, items, truncated, nextOffset? }`. Cada item tem `id`, `title`, `type`, `tags`, `scope` (`global`/`project`), `projectId`, `status` (`active`/`archived`), `updatedAt` e `snippet` (até 240 caracteres do corpo).

Recusas: `type` inválido, `status` inválido, data que não é real, `since` depois de `until`, `limit` fora de 1 a 50, `offset` negativo ou não inteiro. A mensagem diz o campo e a regra.

`read_memory` continua recusando arquivadas. Uma arquivada listada com `status: archived` aparece só com o trecho.

Critério de aceite: um handoff com o título "Última sessão de terminal" e o pedido "Sessão interativa" aparece em `list_recent_memories({ type: 'handoff' })` mesmo quando `search_memory({ term: 'plano' })` não o encontra. Uma memória de outro projeto não aparece sem o `projectId` dela.

### Handoff

Exemplo, numa sessão em branco que trabalhou nas tasks:

```
Título: Sessão de terminal: Iniciar cronômetro de "MCP transações 1/5: schema…"
Pedido: Sessão interativa
Assunto: Iniciar cronômetro de "MCP transações 1/5: schema…"
Resultado: Terminal concluído; consulte o diff arquivado para os detalhes.
Status: completed
Decisões:
- usar a opção B (comprovantes ficam manuais)
Ações pelo MCP (3):
- Iniciar cronômetro de "MCP transações 1/5: …"
- Concluir tarefa "MCP transações 1/5: …"
- Salvar memória decisao "Comprovantes ficam manuais"
Pendências:
- "MCP transações 2/5: …": cronômetro iniciado e não concluída nesta sessão
Arquivos alterados (2):
- src/a.ts
Referências: run=<id>
```

Sem nenhuma fonte, o corpo traz `Sem assunto, decisões ou ações registrados; consulte o histórico local da run <id>.` no lugar de Assunto, Decisões, Ações e Pendências.

Os limites continuam determinísticos e o corpo segue até 2.400 caracteres. O handoff continua com o tipo `handoff`, sem entrar no detector de conflitos.

### Recuperação pela IA

- Descrição de `search_memory`: "Se não achar o contexto, use `list_recent_memories` com type handoff e abra candidatos com `read_memory`."
- Descrição de `list_recent_memories`: explica quando usar, que o conteúdo é evidência histórica e que uma decisão durável encontrada deve virar `save_memory`, com título e tags específicos (a aprovação do Sagyou continua obrigatória).
- Briefing (sessões com pedido): o bloco "DADOS VIVOS" ganha o mesmo roteiro, e as memórias usam o fallback do handoff quando a busca volta vazia.

Critério de aceite: diante de "e o plano da opção B?", o agente que segue o roteiro acha o handoff genérico pela listagem e informa que o registro não tem a decisão. Ele aponta a run e o histórico local e não afirma que a opção B está no handoff.

## Dados

Sem mudança de formato. O handoff é a mesma memória, com o mesmo ID por projeto: só mudam o título e o texto do corpo. Nenhuma tabela, coluna, migração ou campo de backup novo. Handoffs antigos continuam válidos e aparecem na listagem.

## Telas

Nenhuma. O handoff já aparece na tela de memórias com o novo título.

## Perguntas em aberto

(nenhuma)
