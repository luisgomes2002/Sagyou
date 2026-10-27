# MCP: cronômetro das tasks

Status: approved by Luis on 2026-10-27
Branch: feature/mcp-cronometro

## Por quê

Um agente conclui tasks pelo MCP, mas o timer delas fica zerado: o MCP não tem como iniciar ou parar o cronômetro, nem registrar tempo depois. O tempo que a task levou se perde, e os relatórios de tempo ficam errados para tudo o que foi feito por agente.

## Objetivos

- O agente consegue iniciar e parar o cronômetro de uma task, e somar tempo a ela.
- Toda task que o agente implementa é cronometrada sem você precisar pedir.
- Nenhuma hora fantasma: um timer iniciado pelo agente não fica rodando depois que a sessão dele termina.

## Fora do escopo

- Editar ou zerar o `timeSpent` de uma task (só somar).
- Mudar o cronômetro da interface (TaskCard) ou os relatórios.

## Decisões (de Luis, 2026-10-27)

- As três ferramentas rodam **sem cartão de aprovação**, como `update_task` e `complete_task`.
- Se a sessão do agente termina (Stop, erro, terminal fechado) com um timer que **ela** iniciou ainda rodando, o timer **para e o tempo até ali é salvo**.
- O briefing do agente ganha a regra de cronometrar toda task que ele implementar.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- `add_time_spent` aceita de 1 a 86400 segundos (24 h) por chamada.
- `start_task_timer` numa task concluída recusa (`A tarefa já está concluída.`): o store para o timer de task concluída sozinho, então ele não contaria nada.
- O fim da sessão para só os timers que **aquela sessão** iniciou. Um timer que você iniciou à mão continua rodando.
- `complete_task` já para o timer e soma o tempo (comportamento atual do store); ele também tira a task da lista da sessão.

## Comportamento

### `start_task_timer({ id | title, projectId? })`
- Inicia o cronômetro da task. Se já estiver rodando, responde `ok` com `jaRodando: true` e não cria outro.
- Task concluída: recusa com `A tarefa já está concluída.`
- Resposta: `{ ok: true, id, resumo: 'Iniciar cronômetro de "<título>"' }`.

### `stop_task_timer({ id | title, projectId? })`
- Para o cronômetro e soma o tempo decorrido ao `timeSpent`. Resposta com `timeSpent` (segundos) atualizado.
- Sem timer ativo: recusa com `O cronômetro desta tarefa não está rodando.`

### `add_time_spent({ id | title, projectId?, seconds })`
- Soma `seconds` ao `timeSpent`, sem mexer em timer ativo. `seconds` inteiro de 1 a 86400; fora disso recusa com `seconds deve ser um inteiro entre 1 e 86400.`
- Resposta com `timeSpent` atualizado.

### Escopo
As três usam o mesmo `resolveTask` das outras ferramentas de task: mesmo escopo de projeto da sessão, mesma busca por id ou título, mesmos candidatos quando o título é ambíguo.

### Fim da sessão
O main registra, por run, as tasks cujo timer foi iniciado por `start_task_timer`. `stop_task_timer`, `complete_task` e `delete_task` tiram a task da lista. Quando a run termina, antes de revogar o MCP, o main manda parar cada timer que sobrou. Erro ao parar um timer não impede a limpeza da run.

### Briefing
A seção `DADOS VIVOS` do briefing ganha: `Ao começar a trabalhar numa tarefa do Sagyou, chame start_task_timer nela; complete_task para o cronômetro. Se não iniciou o cronômetro, registre o tempo com add_time_spent antes de concluir.`

## Dados

Sem mudança de dados. Usa os campos que já existem: `Task.timeSpent` (segundos) e `activeTimers` (persistido). A lista de timers por run fica só na memória do main.

## Telas

Nenhuma tela nova. O timer iniciado pelo agente aparece no card como um timer iniciado à mão.

## Perguntas em aberto

Nenhuma.
