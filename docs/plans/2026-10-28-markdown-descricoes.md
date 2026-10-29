# Plano de implementação: Markdown nas descrições

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-markdown-descricoes.md
Branch: feature/markdown-descricoes

**Objetivo:** renderizar e editar Markdown em tasks, notas e hábitos, preservando strings existentes e dados antigos.

**Arquitetura:** Um componente compartilhado oferece textarea, toolbar e prévia com `react-markdown` + `remark-gfm`. TaskModal, NoteModal/StickyNoteCard e HabitModal usam essa UI. Um campo opcional em Habit é persistido com migração idempotente no main e transportado por backup.

## Restrições globais

- Nunca habilitar `rehype-raw` ou renderizar `dangerouslySetInnerHTML` para texto de usuário/MCP.
- Links externos passam por `setWindowOpenHandler` e `safeExternalUrl`; não navegar a janela principal. Protocolos não permitidos não são links clicáveis.
- Task.description e StickyNote.content continuam strings idênticas no store, SQLite e backup.
- Habit.notes é opcional. Banco e backup antigos sem campo continuam válidos; não remover ou renomear campos.
- Sem syntax highlighting, imagens Markdown ou conversão automática de texto antigo.
- A leitura de anotações do hábito fica na prévia do `HabitModal` existente, aberto pelo card; `HabitCard` permanece compacto.
- Notas legadas com marcação HTML já armazenada passam pela conversão de exibição equivalente a `plainContent` de `StickyNoteCard` apenas na prévia. O `content` salvo não muda; Markdown novo, inclusive autolinks, não passa por esse tratamento.

## Foco de review

1. **HTML executável:** descrição vinda do MCP com tag/script não cria elemento executável. Testado na Task 1.
2. **Link perigoso:** `javascript:`, `file:`, `data:` e URL com credenciais não abrem; `https:` abre só fora do app. Testado na Task 1 e no app na Task 4.
3. **Dados de hábito antigo:** load/import sem `notes` preserva completions e demais campos. Testado na Task 2.
4. **String alterada sem salvar:** alternar edição/prévia não grava nem transforma Markdown. Testado na Task 1 e Task 3.
5. **Nota do canvas alterada:** `type: 'text'` mantém largura/fonte, e salvar/reabrir mantém texto original. Testado na Task 3.

### Task 1: visualizador e editor seguros

**Arquivos:** criar `src/renderer/src/components/MarkdownEditor.tsx`, `MarkdownPreview.tsx` e testes `src/renderer/src/__tests__/components/MarkdownEditor.test.tsx`, `MarkdownPreview.test.tsx`; modificar CSS global de renderer para tabela, citação e código.

**Interfaces:** `MarkdownEditor({ value, onChange, initialMode, label })` oferece edição/prévia e toolbar; `MarkdownPreview({ value })` renderiza GFM e links seguros.

- [ ] Testes RED: negrito, itálico, lista, checklist, citação, tabela e código renderizam; HTML bruto não executa; URL não permitida vira texto; `https:` tem `target=_blank` e `rel=noopener noreferrer`; toolbar envolve seleção e preserva string até `onChange`.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/components/MarkdownEditor.test.tsx src/renderer/src/__tests__/components/MarkdownPreview.test.tsx`; falha por componentes ausentes.
- [ ] Implementar com libs instaladas. A validação de URL no renderer espelha o filtro do main para apresentação, mas o main segue como autoridade de abertura.
- [ ] Testes verdes, typecheck; commit `feat(markdown): editor e previa seguros`.

### Task 2: anotações de hábito e persistência

**Arquivos:** modificar `src/renderer/src/types/index.ts`, `src/renderer/src/store/slices/habits.ts`, `src/renderer/src/store/normalization.ts`, `src/main/store.ts`, `src/main/modules/files/backup-validation.ts`, `src/main/modules/files/backup-repair.ts` se necessário; testes em `src/renderer/src/__tests__/store/habit-notes.test.ts` e `src/main/__tests__/backup-validation.test.ts`. Migração SQLite é verificada no app, pois `better-sqlite3` não carrega no Vitest.

**Interfaces:** `Habit.notes?: string`; `createHabit` e `updateHabit` aceitam `notes`; `habits.notes TEXT` nullable.

- [ ] Teste RED: criar/editar habit preserva nota e completions; normalizador aceita ausência; backup antigo sem notes é válido; notes com tipo errado não derruba habit. Verificar no app load de banco antigo e save/reload.
- [ ] Adicionar `ALTER TABLE habits ADD COLUMN notes TEXT` somente quando ausente; atualizar insert/select; backup/export mantém notes. Não escrever valor vazio em todo registro antigo sem necessidade.
- [ ] Rodar testes específicos e typecheck; commit `feat(habits): persistir anotacoes opcionais`.

### Task 3: integrar nas três superfícies

**Arquivos:** modificar `src/renderer/src/components/modals/TaskModal.tsx`, `NoteModal.tsx`, `HabitModal.tsx`, `src/renderer/src/components/StickyNoteCard.tsx`, `src/renderer/src/components/views/HabitView.tsx`; testes em `src/renderer/src/__tests__/components/TaskModal.test.tsx`, `NoteModal.test.tsx`, `HabitModal.test.tsx`.

- [ ] Teste RED: task com descrição abre em leitura, vazia em edição; Nota renderiza no card, `type: 'text'` mantém fonte/largura; nota HTML legada tem a mesma leitura sem regravar bytes; hábito exibe anotação na prévia do `HabitModal`, salva e reabre; alternar para prévia não persiste o rascunho.
- [ ] Integrar editor compartilhado. No `StickyNoteCard type: 'text'`, substituir o autosave de 350 ms/blur por botão **Salvar** explícito enquanto há rascunho Markdown; cancelar restaura o conteúdo salvo. A troca edição/prévia não dispara `onUpdate`. Não converter strings antigas.
- [ ] Testes verdes, typecheck; commit `feat(markdown): mostrar previa em tasks notas e habitos`.

### Task 4: revisão e PR

- [ ] Testar round-trip de backup com Markdown de task, nota e habit, incluindo backup antigo sem `notes`; verificar schema SQLite migrado idempotentemente.
- [ ] Rodar `npm run typecheck`, `npm test`, `npm run lint`; verificar no app com `npm run dev` links externos e aparência das três superfícies.
- [ ] Revisar os cinco focos e, por mudar persistência, atualizar `CLAUDE.md`, `GUIDE.md` e `README.md` se a arquitetura ou regra mudou.
- [ ] Abrir PR para `main` com template e seção Dados; não fazer merge.
