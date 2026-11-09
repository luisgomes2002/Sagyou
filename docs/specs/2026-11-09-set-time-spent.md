# Corrigir o tempo gasto de uma tarefa pelo MCP (`set_time_spent`)

Status: approved by Luis on 2026-11-09
Branch: feature/set-time-spent

Origem: tarefa "MCP: corrigir o tempo gasto de uma task (set_time_spent)".

## Por quê

Pelo MCP só dá para **somar** tempo: `stop_task_timer` credita o que o cronômetro correu e
`add_time_spent` aceita de 1 a 86 400 s. Quando o cronômetro fica ligado sem ninguém
trabalhar (em 2026-11-06, a tarefa "Sync 6.7" somou ~3 h com o limite de uso do Claude
estourado), o agente não consegue corrigir. O app também não tem onde editar o tempo à mão:
o detalhe da tarefa só mostra o total e o iniciar/pausar.

## Objetivos

- Ferramenta MCP nova `set_time_spent`, que **define** o total de tempo gasto de uma tarefa.
- Diminuir o tempo pede cartão de aprovação; aumentar não.
- Com o cronômetro da tarefa rodando, a correção para o cronômetro sem creditar o tempo
  dele e grava o total informado, numa chamada só.

## Fora do escopo

- Editar o tempo pela tela do app (pode virar outra tarefa).
- Mudar `add_time_spent` (continua somando de 1 a 86 400 s).
- Corrigir tempo de várias tarefas de uma vez.

## Decisões (de Luis, 2026-11-09)

1. **Forma:** ferramenta nova `set_time_spent`; `add_time_spent` não muda.
2. **Cartão só para diminuir:** se o total novo é menor que o atual, pede cartão (PC ou
   celular, como as outras escritas arriscadas); igual ou maior passa sem cartão.
3. **Cronômetro rodando:** para sem somar o tempo que ele correu e grava o total informado.
4. **Só MCP:** nenhuma tela nova.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Argumentos:** `projectId?`, `id?`/`title?` (mesma referência de tarefa das outras
   ferramentas) e `seconds`, inteiro de **0 a 31 536 000** (365 dias). Fora disso: recusa
   com "seconds deve ser um inteiro entre 0 e 31536000." (sem cartão).
2. **"Total atual"** para decidir o cartão = `timeSpent` + o tempo que o cronômetro da
   tarefa correu até agora, se estiver rodando. Assim, corrigir as 3 h ociosas do exemplo
   (total novo menor que o que o cronômetro mostra) pede cartão.
3. **Como o cartão é decidido:** hoje é só pelo nome da ferramenta
   (`MCP_APPROVAL_REQUIRED`). `set_time_spent` entra em `MCP_NO_APPROVAL` (o teste que pina
   a classificação acompanha), e a etapa `prepare` do renderer passa a poder **pedir** o
   cartão (`{ resumo, approval: true }`) quando o valor diminui. A fila nunca dispensa um
   cartão que o nome exige; só acrescenta. Um cartão pedido assim conta como arriscado: o
   modo automático da sessão (`autoApprovesPending`) **não** o responde.
4. **Resumo do cartão:** `Corrigir o tempo de "<título>": <antes> → <depois>`, com horas e
   minutos (`2 h 05 min`, `0 min`), e, com o cronômetro rodando, o sufixo
   ` (para o cronômetro)`.
5. **Resposta da ferramenta:** `{ ok: true, id, timeSpent, cronometroParado: boolean }`.
6. **Cronômetro de uma sessão do Fleet:** se o cronômetro parado foi iniciado pela própria
   sessão (`agent-task-timers.ts`), ele sai do rastreamento dela, para o fim da sessão não
   tentar pará-lo de novo.
7. **Registro:** como as outras escritas MCP (`mcp`/`tool_call` com o resultado, e o
   `onApplied` da fila para o handoff); nunca o título da tarefa no log.
8. **Token externo:** mesmo comportamento (o cartão de diminuir vai ao PC e ao celular).

## Comportamento

- `set_time_spent { id, seconds: 7200 }` numa tarefa com 3 h e sem cronômetro → cartão
  "Corrigir o tempo de "Sync 6.7": 3 h 00 min → 2 h 00 min"; aprovado → total 7200 s.
- Mesma chamada com 1 h → sem cartão → total 7200 s.
- Com o cronômetro rodando há 3 h sobre 1 h já gravada (total atual 4 h) e `seconds: 3600`
  → cartão com " (para o cronômetro)"; aprovado → cronômetro parado, nada do tempo dele é
  somado, total 3600 s.
- Cartão negado ou expirado (5 min): nada muda, o cronômetro continua rodando.
- Tarefa inexistente, ambígua ou de outro projeto fora do escopo: as mesmas recusas das
  outras ferramentas de tarefa.
- O total mudado é versionado e sincronizado como qualquer edição da tarefa.

## Dados

Sem mudança de dados: só grava `Task.timeSpent` (já existe, já sincronizado) e mexe nos
cronômetros em memória/`settings` como o `stopTimer` já faz.

## Telas

Nenhuma. O cartão usa os diálogos que já existem (Fleet, acesso externo e aba PC do
celular).

## Perguntas em aberto

(nenhuma)
