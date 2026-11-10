# Celular: tarefas por coluna, filtros e busca no cabeçalho

Status: approved by Luis on 2026-11-10
Branch: feature/mobile-tarefas-navegacao
Task: "Reformular as telas do app mobile e aproximar do desktop" (sprint "Mobile 2"), itens 1 (Tarefas) e 4 (Navegação). Financeiro completo, área de aprovações, notificações e o resto da paridade ficam para specs próprias.

## Por quê

Na aba Tarefas do celular:
- o projeto mostra uma coluna por vez (chips), então não dá para ver o quadro inteiro;
- dentro da coluna, as tarefas de todas as sprints aparecem misturadas, e não há filtro por sprint, prioridade ou tag como no desktop;
- não existe uma visão das tarefas de todos os projetos;
- arrastar a linha para o lado conclui a tarefa, e uma rolagem de lado sem querer marca como completa (o Desfazer de 5 s não basta).

A barra de baixo também está poluída: a Busca ocupa uma aba inteira.

## Objetivos

1. Concluir uma tarefa só com um toque explícito (caixinha); nenhum gesto de lado conclui nada.
2. Ver todas as colunas do projeto de uma vez, em seções empilhadas.
3. Filtrar por sprint, prioridade e tag, com a sprint atual já escolhida e o filtro lembrado por projeto.
4. Ver as tarefas abertas de todos os projetos num lugar só.
5. Tirar a Busca da barra de baixo e pô-la como lupa no cabeçalho.

## Fora do escopo

- Financeiro completo, área de aprovações, tela de notificações e demais itens de paridade da task (specs próprias).
- Arrastar tarefa entre colunas no celular (mover continua pelo formulário da tarefa).
- Reabrir uma tarefa concluída pela lista (continua pelo formulário).
- Mudar o formulário da tarefa (`TaskForm`), o Criar rápido (+) e a tela Próximas, além de trocar o arrastar pela caixinha nas linhas dela.
- Sincronizar filtros entre aparelhos.

## Decisões (de Luis, 2026-11-10)

- **Concluir:** caixinha de marcar à esquerda de cada linha (alvo de 48 dp), com o Desfazer de 5 s que já existe. O arrastar para concluir sai do app inteiro (lista do projeto, Todas as tarefas e Próximas).
- **Quadro:** seções empilhadas, uma por coluna, cada uma com contador e recolhível; a coluna Done vai no fim, recolhida.
- **Filtros:** barra de chips no topo: Sprint, Prioridade e Tag. A Sprint abre já na sprint aberta mais recente do projeto, com as opções "Todas" e "Sem sprint". O filtro fica lembrado por projeto neste aparelho.
- **Todas as tarefas:** um cartão abaixo do cartão Hoje abre as tarefas abertas de todos os projetos, agrupadas por projeto.
- **Busca:** sai da barra de baixo e vira uma lupa no cabeçalho de todas as abas.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- Em "Todas as tarefas" os filtros são só Prioridade e Tag (cada projeto tem as próprias sprints). O filtro dessa tela também é lembrado.
- Seções abertas ou recolhidas não são lembradas: toda vez que o projeto abre, Done vem recolhida e as outras abertas.
- A Sprint lista só sprints abertas do projeto. Uma sprint lembrada que foi encerrada ou apagada volta ao padrão (sprint aberta mais recente, ou "Todas" se não houver).
- Os filtros valem para todas as seções, inclusive Done.
- Cada seção de coluna que não é Done tem o botão "Nova tarefa em <coluna>", que abre o formulário naquela coluna (substitui o botão que hoje fica sob a lista da coluna escolhida).
- Na seção Done e nas tarefas já concluídas não há caixinha; a linha só abre a tarefa.
- O componente `SwipeToComplete` é removido.

## Comportamento

### Linha de tarefa (projeto, Todas as tarefas, Próximas)

- À esquerda, uma caixinha (`accessibilityRole="checkbox"`, desmarcada, rótulo "Concluir <título>", alvo de 48 dp). Tocar conclui como hoje (`completeFromList`: move para a primeira coluna Done, mostra "Tarefa concluída" com Desfazer por 5 s). Projeto sem coluna Done mostra o aviso que já existe, e nada é gravado.
- Tocar no resto da linha abre a tarefa. A ação de acessibilidade "concluir" continua existindo na linha.
- Modo só leitura: a caixinha aparece desabilitada.
- Nenhum gesto horizontal conclui, apaga ou move nada.

### Projeto

- Topo: a barra de filtros (chips "Sprint: <nome>", "Prioridade: <…>", "Tag: <…>"; sem filtro, os rótulos são "Sprint: Todas", "Prioridade: Todas", "Tag: Todas"). Tocar num chip abre uma folha (`BottomSheet`) com as opções em lista de rádios; escolher fecha a folha.
  - Sprint: "Todas", "Sem sprint" e cada sprint aberta do projeto, da mais nova para a mais antiga. Padrão: a sprint aberta mais recente (`latestOpenSprint`); sem sprint aberta, "Todas".
  - Prioridade: "Todas", "Urgente", "Alta", "Média", "Baixa".
  - Tag: "Todas" e cada tag usada nas tarefas do projeto, em ordem alfabética.
- Abaixo, uma seção por coluna, na ordem do quadro, com a coluna Done por último (como hoje). Cabeçalho: "<coluna> (<n>)", botão que recolhe e abre a seção (`accessibilityState.expanded`). Dentro, as tarefas daquela coluna que passam nos filtros, na ordem do quadro.
- Seção sem tarefas (com os filtros): "Nenhuma tarefa aqui." dentro dela.
- Nenhuma tarefa no projeto passa nos filtros: em cima das seções, "Nenhuma tarefa com estes filtros." e o botão "Limpar filtros" (volta tudo para "Todas").
- Projeto sem colunas: o texto que já existe.

### Todas as tarefas

- Na tela de projetos, logo abaixo do cartão Hoje: cartão "Todas as tarefas" com o número de abertas ("12 abertas"; "1 aberta").
- A tela "Todas as tarefas" mostra as tarefas não concluídas de todos os projetos não arquivados, agrupadas por projeto (na ordem dos projetos), com o nome do projeto como cabeçalho da seção e o contador. Filtros: Prioridade e Tag (as tags de todos os projetos).
- Sem tarefas abertas: "Nenhuma tarefa aberta." Com filtros e nada passando: "Nenhuma tarefa com estes filtros." + "Limpar filtros".

### Busca no cabeçalho

- A barra de baixo fica Tarefas, Hábitos, Finanças, Notas (e PC, quando autorizado).
- O cabeçalho de toda aba ganha, à esquerda da engrenagem, uma lupa (rótulo "Buscar", alvo de 48 dp) que abre a tela "Busca" (stack raiz), com o campo já focado. Os resultados abrem como hoje: tarefa e projeto na aba Tarefas, nota em Notas, hábito em Hábitos, o resto em Finanças.
- O (+) continua nas quatro abas de conteúdo.

### Filtros lembrados

- Ficam na tabela `prefs` do celular, só neste aparelho (nunca sincronizados), com as chaves `tasks.filter.<projectId>` e `tasks.filter.all`, valor JSON `{ "sprint": "<id>|all|none", "priority": "<p>|all", "tag": "<tag>|all" }`.
- Valor ilegível ou uma tag que não existe mais: tratado como "Todas" naquele filtro.
- "Desconectar" e o apagamento remoto já apagam toda a tabela `prefs`.

## Dados

Sem mudança de formato sincronizado ou de backup. Só chaves novas na tabela `prefs` do celular (device-only, já apagada no wipe), sem migração: chave ausente = padrão.

## Telas

Celular (design system de `theme.ts` e `ui.tsx`, alvos de 48 dp, sem cor solta):
- **Tarefas › Projetos:** cartão Hoje, cartão "Todas as tarefas" e a lista de projetos.
- **Tarefas › Projeto:** barra de filtros e seções por coluna, com a caixinha em cada linha.
- **Tarefas › Todas as tarefas:** filtros de Prioridade e Tag, seções por projeto.
- **Próximas:** igual a hoje, com a caixinha no lugar do arrastar.
- **Cabeçalho de todas as abas:** lupa "Buscar" + engrenagem "Ajustes".
- **Busca:** tela do stack raiz, com o conteúdo da tela de hoje.
- `a11y.test.tsx` cobre "Todas as tarefas" e a nova Busca.

Versão: celular MINOR (0.6.0 → 0.7.0; se o PR #59 entrar antes, 0.7.0 → 0.8.0). Desktop não muda.

## Perguntas em aberto

(nenhuma)
