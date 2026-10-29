# Copiar e mover tarefas entre projetos

Status: approved by Luis on 2026-10-28
Branch: feature/copiar-mover-tasks

## Por quê

O MCP já move uma tarefa entre projetos, mas a interface não oferece essa ação. Copiar exige criar outra tarefa sem transportar estado de execução do original.

## Objetivos

- Mover uma tarefa existente para outro projeto pela interface.
- Copiar uma tarefa para outro projeto com novo ID, sem tempo gasto nem cronômetro.
- Escolher projeto ativo e coluna de destino em um diálogo com busca.

## Fora do escopo

- Projetos arquivados como destino.
- Cópia de histórico de eventos, tempo gasto, cronômetro, sprint, vínculo de planejamento ou estado de conclusão.
- Copiar ou mover em lote.
- Subtarefas e dependências, que ainda não existem no modelo Task atual.

## Decisões de Luis

- Mover usa `moveTaskToProject`; sprint de origem é removida e tags são mantidas.
- Copiar cria uma tarefa nova com descrição, prioridade e tags; o usuário escolhe se mantém o prazo.
- Cronômetro ativo continua na tarefa movida; a cópia não recebe cronômetro.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- O menu da tarefa oferece **Mover para projeto…** e **Copiar para projeto…**. O diálogo busca pelo nome e exclui projetos arquivados e o projeto atual; a primeira coluna por ordem é pré-selecionada.
- A cópia recebe título, descrição, prioridade e tags do original. O prazo é copiado somente quando a opção **Manter prazo** está marcada; essa opção começa marcada quando há prazo. A cópia é criada como tarefa pendente, sem `completedAt`, `timeSpent`, `sprintId` ou timer.
- Imagens anexadas são duplicadas como arquivos novos em `userData/task-images`, cada uma com novo ID. A cópia nunca compartilha ID de imagem com a origem, pois excluir uma tarefa remove seus arquivos de imagem. Se alguma duplicação falhar, nenhuma tarefa nova é criada e os blobs já duplicados nessa tentativa são limpos.
- Mover preserva `timeSpent` e a entrada em `activeTimers` se o destino não for uma coluna de concluídas. O comportamento atual da store para `moveTaskToProject` para o cronômetro em todo movimento; ele será ajustado para cumprir esta regra. Se a coluna de destino for concluída, o cronômetro é parado e o tempo é creditado, como em outros movimentos para Done.
- Ao mover, `timeBlocks` vinculados à task continuam vinculados pelo mesmo ID; não são copiados ao duplicar.

## Comportamento

- O diálogo só permite confirmar depois de escolher um projeto ativo e uma coluna que pertença a ele. Se a busca não encontrar projeto, mostra `Nenhum projeto encontrado.`.
- Confirmar **Mover** chama `moveTaskToProject(taskId, projectId, columnId)`. O mesmo ID sai do board original e aparece no destino, com sprint limpa, tags, descrição, imagens, prazo e tempo existentes preservados.
- Confirmar **Copiar** duplica os bytes das imagens pelo IPC existente e chama `createTask` com os campos selecionados. A nova tarefa aparece na coluna escolhida; a original permanece onde estava. A conclusão, ordem e `updatedAt` da cópia são novos.
- Falha de leitura ou gravação de imagem exibe `Não foi possível copiar as imagens da tarefa.` e mantém ambas as listas de tarefas inalteradas.
- Se projeto ou coluna desaparecer enquanto o diálogo está aberto, confirmar falha sem mover/copiar e mostra `O destino não está mais disponível.`.
- Cancelar fecha sem alteração.

## Dados

Sem novo campo ou mudança de schema. Mover altera os campos já existentes `projectId`, `columnId`, `sprintId`, `order` e `updatedAt`; os demais são preservados. Copiar cria uma linha de tarefa normal pelo caminho existente, com IDs novos para tarefa e imagens. O backup existente inclui metadados e bytes de imagens; deve continuar restaurando origem e cópia independentemente. `activeTimers` e o espelho legado `activeTimer` continuam persistidos conforme as regras atuais.

## Telas

Menu da tarefa e diálogo de destino com busca, seletor de coluna e opção **Manter prazo** apenas em cópia com prazo. Seguir os estilos atuais de TaskModal e dos diálogos.

## Perguntas em aberto

(nenhuma)
