# Plano de implementação: Arquivos, duplicados e arrastar e soltar

Status: approved by Luis on 2026-10-27
Spec: docs/specs/2026-10-27-arquivos-importacao.md
Branch: feature/arquivos-importacao

**Objetivo:** perguntar antes de importar duplicados, marcar os repetidos já salvos e importar arrastando arquivos.

**Arquitetura:** o main ganha um registro de importação em memória (`modules/files/file-import.ts`): `stage(paths)` valida e guarda caminhos sob tokens; `importStaged([{ token, name }])` copia para `userData/files/<uuid><ext>` e indexa; `discard(tokens)`. Os handlers `files:pick` (seletor), `files:stage-paths` (arrastar) e `files:import`/`files:discard` usam esse registro; `files:upload` sai. No preload, `files.stageDropped(files: File[])` resolve caminhos com `webUtils.getPathForFile`. No renderer, funções puras em `utils/file-duplicates.ts` (`uniqueCopyName`, `planImport`, `repeatedFileIds`) e o hook `useFileImport(scopeProjectId)` com a fila de diálogos, usado por `FilesView` e `TransactionRecordPanel`.

## Restrições Globais

- Sem mudança de dados: `StoredFile`, SQLite e backup ficam iguais.
- O renderer nunca envia caminho de disco para o main copiar: só tokens e o nome exibido. A extensão vem do caminho original no main.
- Nome exibido inválido (vazio, > 255 caracteres, com `/` ou `\`) → usa o nome original.
- Token: uso único, expira em 10 min; token desconhecido/expirado é ignorado.
- `files:stage-paths`: só caminhos absolutos, existentes e `isFile()`; máximo 200 por chamada (o resto conta em `skipped`/`overLimit`).
- Textos exatos da spec: `Arquivo já existe`, `“<nome>” já está neste projeto. Quer salvar outra cópia?`, `… já está nos arquivos gerais. …`, `Salvar cópia`, `Pular`, `Aplicar aos próximos (N)`, `Repetido`, `Repetidos (N)`, `Solte para importar N arquivo(s)`, `Solte para importar os arquivos`, `Pastas não são importadas; arraste os arquivos.`, `Só 200 arquivos por vez; o restante foi ignorado.`
- Cores sólidas: etiqueta `Repetido` em `#d9a640` só no texto; botão primário `#6d5bb8`; overlay com fundo sólido `#16161a` e borda tracejada `#3b3b42`. Nada de opacidade baixa nem brilho.

## Foco de Review

1. **Caminho vindo do renderer:** nenhum IPC novo aceita caminho do renderer, exceto `files:stage-paths`, que valida absoluto/existe/isFile e nunca copia diretamente. Testado na Task 1.
2. **Token reaproveitado ou de outra importação:** segunda chamada com o mesmo token não copia de novo. Task 1.
3. **Pular não deixa lixo:** nada vai para `userData/files` para arquivo pulado; tokens descartados. Tasks 1 e 3.
4. **Comprovantes:** anexar comprovante continua vinculando os ids importados à transação, inclusive cópias. Task 4.
5. **Duplicado dentro da mesma seleção** e `nome (2).pdf` já existente → `(3)`. Task 2.

### Task 1: Registro de importação no main

**Arquivos:** Criar `src/main/modules/files/file-import.ts`. Modificar `src/main/handlers/files.ts`. Teste `src/main/__tests__/file-import.test.ts` (diretório temporário real).
**Interfaces:** `createFileImportRegistry({ filesDir, now?, index })` → `{ stage(paths): { staged: { token, name, size }[]; skipped: number; overLimit: number }, importStaged(items: { token: string; name: string }[]): Promise<StoredFileLike[]>, discard(tokens: string[]): void }`. Handlers: `files:pick` → `{ staged, skipped, overLimit }` (cancelado = listas vazias), `files:stage-paths(paths)`, `files:import(items)`, `files:discard(tokens)`.

- [ ] Passo 1: testes que falham: copia arquivo válido com nome escolhido e extensão do original; pula pasta, relativo e inexistente com `skipped` certo; 201 caminhos → 200 staged e `overLimit: 1`; token usado duas vezes copia uma vez; token expirado (relógio injetado, +10 min) é ignorado; `discard` impede importar; nome com `/` volta ao original; chama `index` com o destino.
- [ ] Passo 2: `npx vitest run src/main/__tests__/file-import.test.ts`. Esperado: FALHA.
- [ ] Passo 3: implementar o registro; em `files.ts` trocar `files:upload` pelos quatro handlers usando o registro (mantém `uploadedAttachmentNames`).
- [ ] Passo 4: mesmo comando. Esperado: PASSA. `npm run typecheck:node`.
- [ ] Passo 5: commit `feat(arquivos): importação em dois passos com token`.

### Task 2: Regras puras de duplicados

**Arquivos:** Criar `src/renderer/src/utils/file-duplicates.ts`. Teste `src/renderer/src/__tests__/utils/file-duplicates.test.ts`.
**Interfaces:** `uniqueCopyName(name, taken: Iterable<string>): string`; `planImport(staged, existingNames)` → `{ direct: { token, name }[]; duplicates: { token, name }[] }`; `repeatedFileIds(files: StoredFile[]): Set<string>` (nome sem caixa + tamanho, ≥ 2).

- [ ] Passo 1: testes: `relatorio.pdf` → `relatorio (2).pdf`; com `(2)` tomado → `(3)`; sem extensão; maiúsculas; `nome (2).pdf` duplicado vira `nome (3).pdf` (a base tira o sufixo ` (n)`); duplicado dentro da seleção; `repeatedFileIds` ignora mesmo nome com tamanho diferente.
- [ ] Passo 2: rodar o teste. Esperado: FALHA.
- [ ] Passo 3: implementar.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(arquivos): regras de nome para cópias e repetidos`.

### Task 3: Hook de importação e diálogo de duplicado

**Arquivos:** Modificar `src/preload/index.ts` (`files.pick`, `files.stageDropped`, `files.import`, `files.discard`; remover `upload`). Criar `src/renderer/src/hooks/useFileImport.tsx` (hook + `DuplicateFileDialog`). Teste `src/renderer/src/__tests__/components/useFileImport.test.tsx`.
**Interfaces:** `useFileImport(scopeProjectId: string | null)` → `{ importStaged(result): Promise<StoredFile[]>, dialog: ReactNode }`; adiciona com `addFiles` e devolve os arquivos criados.

- [ ] Passo 1: testes (Testing Library, `window.electronAPI` mockado): sem duplicados importa direto sem diálogo; duplicado abre `Arquivo já existe` com a mensagem do escopo; `Pular` chama `discard` e não `import` para ele; `Salvar cópia` importa como `nome (2).ext`; com 3 duplicados aparece `Aplicar aos próximos (2)` e marcado decide todos.
- [ ] Passo 2: FALHA.
- [ ] Passo 3: implementar preload (`webUtils.getPathForFile` em `stageDropped`) e o hook.
- [ ] Passo 4: PASSA; `npm run typecheck`.
- [ ] Passo 5: commit `feat(arquivos): perguntar antes de importar duplicado`.

### Task 4: FilesView e comprovantes no fluxo novo

**Arquivos:** Modificar `FilesView.tsx`, `financial/TransactionRecordPanel.tsx`. Teste `src/renderer/src/__tests__/components/FilesView.test.tsx` (novo) e ajuste em `TransactionRecordPanel.test.tsx` se quebrar.

- [ ] Passo 1: testes: botão chama `pick` e adiciona com o `projectId` ativo; etiqueta `Repetido` nas linhas certas; `Repetidos (N)` filtra e some sem repetidos; anexar comprovante vincula os ids importados.
- [ ] Passo 2: FALHA.
- [ ] Passo 3: trocar `handleUpload`/`attach` pelo hook; etiqueta e filtro com `repeatedFileIds`.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(arquivos): mostrar arquivos repetidos`.

### Task 5: Arrastar e soltar

**Arquivos:** Modificar `FilesView.tsx`. Teste no mesmo `FilesView.test.tsx`.

- [ ] Passo 1: testes: dragenter com `Files` mostra `Solte para importar 2 arquivo(s)`; só `text/plain` não mostra; dragleave do container esconde (contador de enter/leave); drop chama `stageDropped` e passa pelo hook; `skipped > 0` mostra o aviso de pastas; `overLimit > 0` mostra o aviso de 200.
- [ ] Passo 2: FALHA.
- [ ] Passo 3: implementar handlers no container da lista e o aviso com timeout de 5 s.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(arquivos): arrastar e soltar para importar`.

### Task 6: Verificação

- [ ] `npm run typecheck`, `npm run lint`, `npm test` verdes.
- [ ] Manual (`npm run dev`, Linux): importar pelo botão com duplicado; arrastar 3 arquivos; arrastar pasta; soltar fora da lista; anexar comprovante duplicado.
- [ ] Atualizar `GUIDE.md`/`CLAUDE.md` se citarem `files:upload`.
