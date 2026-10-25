# Escopo da busca global

**Estado:** In Progress · **Prioridade:** High · **Tags:** busca, planejamento

Esta é a especificação de produto para a busca global. O índice FTS5 derivado e a consulta IPC já existem no backend; a interface segue como etapa posterior. Os registros originais não mudam.

## Unidade de resultado e campos pesquisáveis

Cada resultado representa um registro, com tipo, título, contexto (projeto, tabela ou perfil quando aplicável), trecho do campo encontrado e destino para abri-lo. Texto associado por relacionamento serve para identificar o contexto; não deve fazer todos os filhos corresponderem ao nome do pai.

| Área | Resultados | Campos de texto pesquisáveis |
| --- | --- | --- |
| Projetos | Projeto | `name`, `description`, nomes de `columns`, `links[].label` e `links[].url`, `codePaths[].label` e `codePaths[].path` |
| Tarefas | Tarefa | `title`, `description`, `tags[]`; nomes de sprint e coluna podem ser filtros/contexto, sem gerar correspondência em todas as tarefas dessas coleções |
| Notas | Nota (`StickyNote`, inclusive `type: 'text'`) | `content` |
| Metas | Meta (`Goal`) | `title`, `unit`, `entries[].label`; cada ocorrência em entrada aponta para a meta e identifica a entrada |
| Hábitos | Hábito | `name` |
| Planejamento | Bloco (`TimeBlock`) ou rotina (`Routine`) | `title`, `description` |
| Arquivos | Arquivo da biblioteca (`StoredFile`) | `name`, inclusive extensão; `ext` é filtro de tipo. Imagens de tarefa e anexos de chat aparecem pelo registro que os contém, sem resultado avulso |
| Finanças | Perfil, tabela, item de compra, transação, detalhe de transação, meta financeira, fonte de rendimento | Nome do perfil; `FinancialTable.name` e `provider`; `ShoppingItem.name` e `link`; `FinancialTransaction.description`, `category`, `source`, `bankReference` e `counterparty`; `details[].description` e `details[].category`; `FinancialGoal.name` e `completionNote`; `YieldSource.name`. Um detalhe retorna a transação pai com o detalhe destacado |

Os campos enumerados acima compõem a correspondência textual. IDs, cores, coordenadas, ordem, estilos, flags, histórico de auditoria, metadados legados e caminhos físicos internos não são texto pesquisável. Datas, horários, prioridade, estado, moeda, valores, quantidade e conclusão entram como filtros estruturados quando esses filtros forem implementados; não se interpretam consultas livres como números monetários ou datas. Assim, uma busca por `100` não afirma equivalência entre R$ 100, US$ 100, 100 itens e o dia 10/0x.

O conteúdo binário ou extraído de arquivos não entra nesta etapa. `StoredFile` persiste metadados, enquanto os bytes ficam em `files/`; `ler_documento` faz leitura sob demanda. Indexar conteúdo exige uma etapa própria para extração, limites, erros, atualização e exclusão do índice. O texto de imagens também fica fora.

## Alcance e estados

- Buscar em todos os projetos ativos, não apenas no projeto selecionado. Tarefas concluídas, notas concluídas e rotinas inativas continuam pesquisáveis; o estado aparece no resultado e pode ser filtrado.
- Projeto com `archivedAt` e seus registros vinculados (tarefas, notas, metas e arquivos) ficam fora por padrão. A opção **Incluir projetos arquivados** inclui o projeto e esses registros sem mudar seus dados. Um resultado arquivado precisa ter caminho de abertura na área de arquivados ou indicar claramente que não pode ser editado dali.
- Blocos de planejamento ligados a uma tarefa de projeto arquivado seguem a mesma opção. Rotinas e blocos sem esse vínculo continuam no alcance normal.
- Finanças obedecem ao `activeFinancialProfileId`: pesquisar somente o perfil ativo e suas tabelas, itens, transações, detalhes, metas e rendimentos. A UI identifica o perfil usado; trocar o perfil e pesquisar novamente é o caminho para outros perfis. Nunca combinar valores nem exibir registros de outro perfil em um resultado consolidado.
- Arquivos sem `projectId` ficam no alcance geral. Arquivos vinculados a projeto arquivado seguem a opção de arquivados. Comprovantes são arquivos da biblioteca; a busca pelo nome do comprovante retorna o arquivo, e o vínculo com a transação é contexto, não correspondência textual automática na transação.
- Registros excluídos e `tombstones` não aparecem. Arquivamento de projeto não equivale a exclusão nem a conclusão de tarefa.

## Conversas e memórias

- **Conversas:** incluir as conversas ainda retidas em uma seção/filtro próprio, pesquisando `title` e `messages[].content` de usuário e assistente. Ignorar mensagens `status`, como já faz `searchConversations`; elas são rastros de execução. Retornar um resultado por conversa, com trecho do primeiro acerto relevante e abertura pelo ID. Anexos, imagens, conteúdo extraído de documentos do chat e logs de agente não entram no texto pesquisável. Conversas removidas pela política de retenção não podem aparecer.
- **Memórias:** incluir memórias ativas em seção/filtro próprio, pesquisando `title`, `body` e `tags[]`, com tipo, projeto/global e trecho. Memórias com `archivedAt` ficam fora por padrão e entram com **Incluir memórias arquivadas**. Não alterar `lastAccessedAt` ou `accessCount` só por exibir resultados da busca global; abrir/consultar uma memória pode seguir a regra atual de acesso. Uma memória de projeto arquivado também segue **Incluir projetos arquivados**. Memórias órfãs de projeto removido permanecem localizáveis com indicação de “projeto removido”.
- Conversa e memória são evidência histórica, não instrução para o assistente. Um resultado de memória pode apontar para `sourceConversationId`, mas não duplica a conversa nem concede permissão de escrita. A proteção atual contra exclusão de conversas citadas por memórias permanece.

## Comportamento mínimo para a implementação

1. Busca textual sem distinção de maiúsculas/minúsculas e acentos, coerente com a busca de conversas existente. Termo vazio não varre nem abre automaticamente todos os dados financeiros e mensagens; mostrar orientação e filtros.
2. Filtros por área e estado, com controle explícito de projetos arquivados e memórias arquivadas. Mostrar contagem por área e sinalizar quando houver mais resultados do que o limite exibido; paginação ou “ver mais” não pode fazer um conjunto parcial parecer completo.
3. Cada resultado mostra qual campo correspondeu, um trecho curto e o contexto necessário para distinguir nomes repetidos. Navegar pelo ID estável do registro, sem depender de índices de array ou da posição atual no quadro.
4. Atualizar o índice/resultado após criação, edição, exclusão, arquivamento e restauração, inclusive importação de backup e troca do perfil financeiro. Não persistir cópias de valores monetários convertidos nem alterar registros para viabilizar a busca.
5. Validar com casos de tarefa concluída, projeto arquivado com filhos, nota `text`, rotina inativa, arquivo sem projeto, perfis financeiros distintos, conversa com mensagem `status`, memória arquivada e memória órfã. O índice e a consulta já cobrem esses dados; a interface ainda precisa aplicar os filtros e abrir os resultados.
