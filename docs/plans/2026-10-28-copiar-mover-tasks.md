# Plano de implementação: copiar e mover tarefas

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-copiar-mover-tasks.md
Branch: feature/copiar-mover-tasks

**Objetivo:** oferecer cópia e transferência entre projetos na UI, preservando dados e cronômetros conforme a spec.

**Arquitetura:** A store valida o destino e mantém a operação de mover por ID. A cópia duplica imagens pelo IPC existente antes de criar a nova tarefa. Um diálogo controlado por App escolhe projeto/coluna e é aberto por ações do TaskCard.

## Restrições globais

- Sem novo campo de Task ou schema. O backup continua preservando origem e cópia com IDs de imagem distintos.
- Mover mantém ID, tags, prazo, imagens e tempo; limpa sprint. Cronômetro só para ao entrar numa coluna concluída.
- Copiar usa novo ID, sem sprint, conclusão, tempo, timer ou blocos de planejamento.
- Nenhuma imagem da origem pode ser apagada ou compartilhada pela cópia. Falha parcial limpa apenas blobs criados na tentativa.
- Projetos arquivados e o projeto atual não são destinos. Coluna precisa pertencer ao projeto escolhido. Para cópia, colunas concluídas são omitidas, pois a nova task nasce pendente.

## Foco de review

1. **Imagem compartilhada:** excluir origem após copiar não quebra imagens da cópia. Testado na Task 2.
2. **Cópia parcial:** falha no segundo blob não cria tarefa e limpa primeiro blob duplicado. Testado na Task 2.
3. **Cronômetro perdido:** mover task ativa para coluna pendente mantém timer; concluir credita tempo e para. Testado na Task 1.
4. **Destino inválido:** projeto arquivado, removido ou coluna de outro projeto não alteram estado. Testado nas Tasks 1 e 3.
5. **Dados associados:** sprint limpa no movimento; tags, descrição, prazo e timeSpent preservados. Testado na Task 1.

### Task 1: mover sem perder cronômetro

**Arquivos:** modificar `src/renderer/src/store/slices/tasks.ts`; criar `src/renderer/src/__tests__/store/task-transfer.test.ts`.

**Interfaces:** `moveTaskToProject(taskId, projectId, columnId): boolean` existente. Adicionar checagem de `archivedAt` na store; a UI repete a restrição para não listar arquivados.

- [ ] Teste RED: mover task com timer ativo entre colunas pendentes preserva `activeTimers`, `timeSpent`, tags, imagens, prazo e ID, mas limpa `sprintId`; mover para Done para e credita tempo; destino inválido ou arquivado retorna `false` sem mutação.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/store/task-transfer.test.ts`; falha pelo `stopTimer` atual.
- [ ] Ajustar a store para parar timer somente quando `isDoneColumn(column)`; preservar espelho `activeTimer` na persistência existente.
- [ ] Teste verde, typecheck; commit `fix(tasks): preservar cronometro ao mover projeto`.

### Task 2: duplicar tarefa e imagens

**Arquivos:** criar `src/renderer/src/services/task-copy.ts` e `src/renderer/src/__tests__/services/task-copy.test.ts`; usar `window.electronAPI.taskImages.get/save/delete`.

**Interfaces:** `copyTaskToProject(task, destination: { projectId: string; columnId: string; keepDueDate: boolean }, deps: { createTask; getImage; saveImage; deleteImages; isValidDestination }): Promise<string>` duplica blobs em série, revalida destino após cada await e chama `createTask` só ao concluir todos.

- [ ] Teste RED: novo ID e campos copiados; prazo opcional; sem tempo/conclusão/sprint; cada imagem com ID diferente; falha na segunda imagem limpa o primeiro blob e não cria task; destino removido durante cópia ou `createTask` que lança erro limpa novos blobs e não cria task; excluir original não apaga imagens da cópia.
- [ ] Rodar teste específico e observar falha pela interface ausente; implementar via IPC existente, sem novo handler.
- [ ] Teste verde, typecheck; commit `feat(tasks): copiar tarefa com imagens independentes`.

### Task 3: diálogo de destino

**Arquivos:** criar `src/renderer/src/components/modals/TaskTransferModal.tsx` e teste `src/renderer/src/__tests__/components/TaskTransferModal.test.tsx`; modificar `src/renderer/src/components/TaskCard.tsx`, `src/renderer/src/components/Column.tsx`, `src/renderer/src/components/views/Board.tsx` e `src/renderer/src/App.tsx`.

**Interfaces:** `TaskTransferModal({ mode, task, projects, onConfirm, onClose })`; `onConfirm({ projectId, columnId, keepDueDate })`. App chama `moveTaskToProject` ou `copyTaskToProject`.

- [ ] Teste RED: ações **Mover para projeto…** e **Copiar para projeto…**; busca exclui arquivados e origem; primeira coluna elegível por ordem pré-selecionada; cópia omite colunas Done e recusa projeto sem coluna pendente; troca de projeto reseta coluna; **Manter prazo** só na cópia com prazo; cancelamento não muta; destino removido mostra `O destino não está mais disponível.`.
- [ ] Implementar menu de ações no card e diálogo no App, sem interromper drag do dnd-kit por eventos de clique do menu.
- [ ] Teste verde, typecheck; commit `feat(board): copiar e mover tarefas pela interface`.

### Task 4: revisão e PR

- [ ] Testar round-trip de backup com task e imagens independentes, usando `src/renderer/src/store/slices/backup.ts` e fixtures; confirmar imagens após excluir a origem.
- [ ] Rodar `npm run typecheck`, `npm test`, `npm run lint`; verificar no app com `npm run dev` o menu, busca, prazo e mensagens.
- [ ] Revisar os cinco focos e abrir PR para `main` com template. Não fazer merge.
