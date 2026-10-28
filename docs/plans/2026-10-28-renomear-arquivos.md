# Plano de implementação: renomear arquivos

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-renomear-arquivos.md
Branch: feature/ajustes-rapidos

**Objetivo:** renomear um arquivo na tela Arquivos mantendo extensão, bytes e vínculos.

**Arquitetura:**
- A validação é uma função pura em `utils/file-rename.ts`.
- O slice ganha `renameFile`.
- A UI fica em `FileRow`, dentro de `components/views/FilesView.tsx`.
- Main, preload e IPC não mudam: o nome existe só no store e na tabela `files`, gravado pelo `_persist` de sempre.

## Restrições Globais

- Nenhuma mudança de schema, backup ou normalização. Não muda `id`, `ext`, `size`, `createdAt` nem `projectId`.
- Nada no disco é renomeado. Os bytes continuam em `files/<id><ext>`.
- Textos em pt-BR, exatamente os da spec.
- Visual: regras de `~/.claude/CLAUDE.md` (sem fundo com opacidade baixa, sem neon).

## Foco de Review

1. **Vínculo perdido.** O comprovante continua ligado à transação depois de renomear. Testado na Task 2.
2. **Extensão alterada.** O nome gravado termina sempre com a extensão original. Testado nas Tasks 1 e 2.
3. **Duplicado no escopo.** A recusa vale só entre arquivos do mesmo projeto, ou de Geral. Testado na Task 1.

### Task 1: validação e ação do store

**Arquivos:**
- novo `src/renderer/src/utils/file-rename.ts`;
- `src/renderer/src/store/slices/files.ts`;
- testes em `__tests__/utils/file-rename.test.ts` (novo) e no teste do slice de arquivos, se houver; senão, um bloco em `file-rename.test.ts` usando o store.

**Interfaces:**
- `fileStem(file): string`: o nome sem a extensão do arquivo.
- `validateFileRename(file, rawStem, siblings): { ok: true; name: string; unchanged: boolean } | { ok: false; error: string }`.
  - `siblings` são os arquivos do mesmo escopo.
  - `name = stem.trim() + file.ext`.
- `renameFile(id, name)` no `FilesSlice`: troca só `name` e persiste.

Passos:
- [ ] Testes:
  - remove espaços nas pontas;
  - cada recusa com o texto exato;
  - igual ao atual → `unchanged`;
  - mudança só de maiúsculas no mesmo arquivo é permitida;
  - duplicado de outro arquivo do escopo é recusado, de outro escopo não;
  - a extensão é preservada;
  - `renameFile` muda só `name`, e um comprovante vinculado continua em `receiptFileIds`.
- [ ] Ver falhar → implementar → ver passar.
- [ ] Commit `feat(arquivos): validação e ação para renomear arquivo`

### Task 2: ação Renomear na tela Arquivos

**Arquivos:** `src/renderer/src/components/views/FilesView.tsx`; teste em `__tests__/components/FilesView.test.tsx`.

Passos:
- [ ] Testes de componente:
  - Renomear abre o campo com o nome sem extensão;
  - Enter grava e a lista mostra o nome novo com a extensão;
  - Esc cancela sem gravar;
  - nome duplicado mostra o erro e não grava.
- [ ] Ver falhar → implementar → ver passar.
- [ ] Typecheck, testes e lint dos arquivos alterados.
- [ ] Commit `feat(arquivos): renomear na tela Arquivos`

### Task 3: PR

- [ ] Suíte completa, review contra o Foco de Review e PR junto com a task dos Hábitos ("Sem mudança de formato de dados persistidos").
