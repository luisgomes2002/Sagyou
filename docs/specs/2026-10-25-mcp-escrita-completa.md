# MCP com escrita completa

Status: approved by Luis on 2026-10-25
Branch: feature/mcp-escrita-completa

## Por quê

O `sagyou-mcp` (a ponte entre Codex, Claude Code e OpenCode e os dados do Sagyou) hoje quase só lê: a única escrita de dados do app é `criar_task`, além de `save_memory`. Quando um agente termina um trabalho, Luis precisa voltar ao app para concluir a tarefa, corrigir um prazo, lançar uma transação, registrar o progresso de uma meta ou arquivar uma memória errada. A ideia é que tudo que o MCP hoje "não consegue" passe a ser possível, para o agente cuidar disso sozinho.

## Objetivos

- Projetos: criar, renomear, editar descrição/cor/colunas/links, arquivar, desarquivar, excluir.
- Tarefas: editar título, descrição, prazo, prioridade e tags; mover de coluna (o que conclui/reabre); concluir; reabrir; mover para outro projeto; excluir.
- Metas: criar, editar, registrar progresso, concluir, excluir.
- Notas (canvas): criar, editar, excluir.
- Finanças (só no perfil da sessão): criar/editar/excluir transações; criar tabela nova escolhendo a moeda; adicionar/remover categorias personalizadas; criar e renomear perfis.
- Memórias: editar, arquivar, desarquivar, excluir, e resolver uma contradição apontada por `check_memories`.
- Só as ações arriscadas pedem aprovação; o resto entra direto.

## Fora do escopo

- **Conversas** (apagar, renomear, ler anexos): o histórico de chat foi removido do app (`2026-10-24-remover-historico-chat`); não há conversa para mexer pelo MCP.
- **Atribuir tarefa a alguém**: o app tem um usuário só e tarefa não tem responsável. Sem campo novo.
- **Pastas de código do projeto**: o agente não adiciona, remove nem seleciona pastas de código. Isso daria a ele leitura de outros diretórios do disco.
- **Trocar a moeda de uma tabela financeira existente**: reinterpretaria valores já lançados (R$ 100 viraria ¥ 100).
- Escrever em outro perfil financeiro que não o capturado na sessão, nem excluir perfis.
- Dívidas, listas de compras, metas financeiras, hábitos, planner e sprints: não estavam na lista do pedido; ficam para uma spec futura.
- Mudanças no chat interno do Sagyou (`ai/tools.ts`); isto é só o MCP dos executores.

## Decisões (de Luis)

1. **Só o arriscado pede aprovação.** Exigem cartão de aprovação no Sagyou: qualquer exclusão (projeto, tarefa, meta, nota, transação, memória, categoria), arquivar projeto, toda escrita de dinheiro (criar/editar transação), criar tabela financeira, criar/renomear perfil financeiro e `save_memory` (já é assim). Todo o resto entra sem cartão.
   - ⚠️ Isto muda a regra atual da arquitetura ("MCP writes ... execute only after approval"). Escritas sem cartão continuam passando pela mesma fila serializada por run, com flush do renderer antes de executar; só o cartão é dispensado. `CLAUDE.md`, `GUIDE.md` e `docs/harness-chat-architecture.md` serão atualizados.
2. Atribuição fica de fora (ver acima).
3. **Finanças no modo seguro**: transações, categorias e tabelas novas só no perfil da sessão; criar/renomear perfis permitido; nunca trocar moeda de tabela existente.
4. **Configurações de projeto**: nome, cor, descrição, colunas e links. Pastas de código não.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Resolver contradição = arquivar o lado perdedor.** `resolve_memory_conflict(keepId, archiveId)` arquiva um dos dois e opcionalmente atualiza o corpo do que fica. Nada é apagado; arquivar é reversível, por isso não pede cartão.
- **Arquivar/desarquivar memória e desarquivar projeto não pedem cartão** (reversíveis). Arquivar projeto pede cartão (some da barra lateral e do board).
- **Excluir coluna com tarefas é recusado**, com a mensagem "A coluna \"<nome>\" tem N tarefa(s); mova-as antes de excluí-la." Renomear e reordenar colunas é livre. Não é permitido ficar sem nenhuma coluna.
- **Mover tarefa para outro projeto** coloca-a na primeira coluna do projeto destino, a menos que `coluna` seja dada (resolvida no projeto destino). Sprint é limpa (sprints são por projeto). Um cronômetro rodando para a tarefa é parado e creditado antes.
- **Memória do tipo `handoff` não é editável nem resolvível pelo MCP**; o escritor de fim de run é o único dono. Editar uma memória fixada mantém a fixação. Toda edição passa por `buildMemory` (validação + remoção de segredos), como o `save_memory`.
- **Escopo de projeto nas escritas**: igual ao `criar_task`. Sessão de projeto usa o projeto inicial quando `projectId` é omitido; sessão geral exige `projectId`. Qualquer projeto existente pode ser alvo, por ID.
- **Ambiguidade é erro, nunca escolha**: tarefa/meta por título que bate com mais de um registro retorna a lista de candidatos (id + título) e não escreve. O caminho preferido é por `id`.
- **Nomes das ferramentas**: em inglês e `snake_case`, seguindo as novas (`read_tasks`, `save_memory`), ex.: `update_task`, `delete_task`, `create_transaction`. A lista exata sai no plano.
- **Cada escrita reaproveita a ação do store do renderer** (`updateTask`, `moveTask`, `deleteTask`, `createGoal`, `addGoalEntry`, `applyFinancialTransactionEdit`…) pela ponte que `criar_task` já usa, em vez de escrever SQL no main. Assim valem as mesmas regras do app (tombstones, auditoria financeira, decimal string, Done boundary). Memória continua escrita no main, como hoje.
- **Permissões**: cada ferramenta nova vira uma entrada em `MCP_PERMISSIONS`, concedida por padrão a toda sessão (como as atuais), para o agente só enxergar o que a sessão autoriza.

## Comportamento

- **Ferramenta com cartão**: chama a fila; o cartão mostra a ação e um resumo legível (ex.: "Excluir tarefa \"Corrigir login\" do projeto Sagyou", "Lançar despesa de R$ 1.500,00 em Nubank — Mercado — 2026-10-25"). Negado → `{ ok: false, error: "<Ação> não aprovada pelo usuário." }`, nada muda. Timeout ou fim da run → mesma recusa (fail-closed, como hoje).
- **Ferramenta sem cartão**: executa na fila e responde `{ ok: true, id, ... }` com o estado resultante relevante (ex.: `concluida: true` quando mover para Done concluiu).
- **Validação antes de enfileirar**, com mensagem de erro e nada gravado:
  - prazo precisa ser `YYYY-MM-DD` real; prioridade dentro de `PRIORITY_CONFIG`; cor dentro de `PROJECT_COLORS`;
  - valor de transação positivo, decimal sem separador de milhar (mesmas regras do `parseMoney` do chat), guardado como decimal string com 2 casas; o tipo (`receita`/`despesa`) carrega o sinal;
  - meta: `target` finito > 0; progresso positivo em meta de quantidade; meta já atingida → no-op `{ ok: true, jaConcluida: true }`;
  - nome de projeto aparado e não duplicado (duplicado devolve o `projectId` existente, como no chat);
  - tabela financeira de outro perfil, ou ID de outro perfil → "Tabela indisponível nesta sessão MCP." (a mesma resposta para inexistente, para não vazar existência).
- **Editar tarefa** só mexe nos campos enviados; `""`/`[]` limpam explicitamente; tags substituem a lista.
- **Excluir tarefa** é exclusão definitiva com tombstone (mesmo `deleteTask` do app). Excluir projeto apaga o projeto e suas tarefas, exatamente como o botão do app (notas e metas ficam); o cartão mostra quantas tarefas vão junto. (Corrigido no plano: a versão aprovada dizia que as notas iam junto, o que o botão não faz.)
- **Editar transação** passa por `applyFinancialTransactionEdit` (auditoria, `updatedAt`, limpa `reconciledAt` quando muda valor/data/tipo). Transação de pagamento de dívida não pode ser editada nem excluída pelo MCP: "Esta transação pertence a uma dívida; altere-a no Sagyou."
- **Remover categoria** não reescreve transações antigas (mesma regra do app).
- **Nota nova** usa uma posição livre no canvas (como `criar_nota` do chat), não empilha em (100,100).
- Respostas continuam pequenas: escritas devolvem id e o essencial, nunca o registro inteiro.

## Dados

Sem mudança de dados. Nenhum campo, tabela ou formato novo; todas as escritas usam ações e campos que o app já persiste (SQLite via `persistAll`, memória via suas instruções próprias). Backup inalterado.

## Telas

Nenhuma tela nova. O cartão de aprovação MCP existente no Fleet passa a mostrar os novos tipos de ação com o resumo legível acima. Escritas sem cartão aparecem refletidas nas views normais (board, metas, financeiro, memória) assim que o store recebe a ação.

## Perguntas em aberto

(nenhuma)
