# Plano de implementação: Reformulação de design e UX do app Android

Status: approved by Luis on 2026-11-01
Spec: docs/specs/2026-11-01-mobile-design-ux.md
Branch: feature/mobile-design-ux

**Objetivo:** o app Android passa a parecer o Sagyou do PC, a criar em 1 toque pelo (+) e a mostrar o essencial na primeira tela de cada aba, sem mudar nenhum dado sincronizado.

**Arquitetura:**
- Tokens e componentes novos ficam em `apps/mobile/src/theme.ts` e `apps/mobile/src/components/` (um arquivo por componente, reexportados por `ui.tsx` para os imports atuais continuarem valendo).
- As regras de tela que dá para testar sem renderizar (agrupar Próximas, resumo do mês, dia do lançamento, ícone da categoria, destaque da busca, padrões do criar rápido, desfazer) ficam em funções puras em `apps/mobile/src/store/*.ts`, cada uma com teste próprio.
- As telas só montam esses componentes e essas funções. Edição continua passando por `useApp().commit`.

## Restrições Globais

- Paleta só a dos tokens de `theme.ts`, que já seguem o `UI_DESIGN.md`. Sem hex solto nas telas.
- Sem `shadow` colorido, sem `glow`, sem pulso infinito. Animação ≤ 200 ms, desligada quando `AccessibilityInfo.isReduceMotionEnabled()`.
- Raios: cartão e folha **12**, campo e botão **10**, chip e (+) **999**. Espaço: **4/8/12/16/24**. Fonte: **12/14/16/20/28**. Valores com `fontVariant: ['tabular-nums']`.
- Alvo de toque **≥ 48 dp** (`MIN_TOUCH = 48`). Contraste **≥ 4,5:1** para texto e **≥ 3:1** para ícone, nos dois temas.
- Snackbar de desfazer dura **5000 ms** (`UNDO_MS`). Um novo substitui o anterior.
- Pref nova: `quick.lastProject`. A última tabela continua em `lastTablePref(profileId)`. Nenhuma outra chave nova.
- Textos que **não mudam**: `DISCONNECTED_TEXT`, `OFFLINE_TEXT`, `INVALID_AMOUNT_TEXT`, `LOCKED_TEXT`, `DATE_FORMAT_ERROR` (não é mais usado no formulário novo, mas fica exportado), os textos de `PairScreen` e `lock/texts.ts`, `DISCONNECT_LABEL` e o aviso de desconectar.
- Edições só por `commit(next)`. Nenhuma tela grava em `records`/`prefs` direto, exceto `writePref` de "último usado".
- Dependências novas, instaladas **só** com `npx expo install` dentro de `apps/mobile`: `lucide-react-native`, `react-native-svg`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets` (exigido pelo reanimated 4), `expo-haptics`, `@react-native-community/datetimepicker`, `expo-splash-screen`.
  - O plugin de worklets entra pelo `babel-preset-expo`, sem `babel.config.js` próprio (decisão do construtor). Se o typecheck ou o Jest acusarem falta dele, cria-se o `babel.config.js` mínimo com `presets: ['babel-preset-expo']`.
  - O `package-lock.json` da raiz entra no mesmo commit.
- Dinheiro: `D()` de `@sagyou/core/money`. Sem importar `decimal.js` direto no mobile.
- Testes antigos que tocam botões removidos ("Concluir", "Nova tarefa", "Novo gasto", "Nova receita", "Nova nota") são **reescritos** na task que remove o botão, cobrindo o mesmo comportamento pelo caminho novo. Nenhum teste é apagado sem substituto.
- Testes: `npm test -w @sagyou/mobile -- <arquivo>`; tipos: `npm run typecheck -w @sagyou/mobile`. Testing Library v14: `render`/`fireEvent` são async, sempre com `await`. E2E nunca roda local.

## Foco de Review

1. **Desfazer que estraga a tarefa.** Desfazer a conclusão devolve `columnId`, `order` e `completedAt` exatamente como antes e preserva o resto (imagens, `timeSpent`, tags, sprint). Desfazer depois de uma mudança remota na mesma tarefa não sobrescreve os outros campos: só reverte coluna, ordem e conclusão. Projeto sem coluna Done não mostra "Tarefa concluída" nem vibra. *Testado na Task 4.*
2. **Dados existentes intactos.** Carregar → abrir todas as telas → nada editado = **zero** versões novas (invariante de `records.test.ts`). O criar rápido usa as mesmas funções puras (`createTask`, `addTransaction`, `createNote`) e não inventa campos. *Testado nas Tasks 4 e 8.*
3. **Criar rápido no lugar errado.** Um `quick.lastProject` de projeto apagado ou arquivado cai no primeiro projeto ativo. Projeto sem coluna fora de Done cria na primeira coluna. Projeto sem sprint aberta cria sem sprint. A tabela de outro perfil nunca é escolhida. *Testado na Task 3.*
4. **Dinheiro.** O resumo do mês soma com `D()` por tabela, nunca mistura moedas, e o valor digitado passa por `parseAmount(text, table.currency)`. *Testado nas Tasks 3 e 5.*
5. **Somente leitura e bloqueio.** Com `readOnly`, o (+), deslizar, o botão "Hoje" e Salvar (inclusive nas folhas do criar rápido) não editam nada. `LockGate` continua cobrindo tudo antes de desbloquear, inclusive o (+) e as folhas. *Testado nas Tasks 3, 4, 5 e 7.*

---

### Task 1: Design system (tokens + componentes base)
*Tarefa do Sagyou: "Mobile: design system (tokens + componentes base)".*

**Arquivos:**
- Modificar `apps/mobile/src/theme.ts` e `apps/mobile/src/components/ui.tsx` (passa a reexportar).
- Criar em `apps/mobile/src/components/`: `Button.tsx`, `Field.tsx`, `Chip.tsx`, `Card.tsx`, `ListItem.tsx`, `Header.tsx`, `EmptyState.tsx`, `BottomSheet.tsx`, `Fab.tsx`, `Badge.tsx`, `Snackbar.tsx`.
- Instalar as dependências das Restrições Globais e mockar em `apps/mobile/jest.setup.js`:
  - `react-native-reanimated/mock`;
  - `react-native-gesture-handler/jestSetup`;
  - `expo-haptics` (funções `jest.fn`, mais `ImpactFeedbackStyle`);
  - `@react-native-community/datetimepicker`: um componente que renderiza `<View testID="date-picker" />` e expõe as props, para o teste chamar `onChange`.
- Teste: `apps/mobile/src/__tests__/theme.test.ts` e `apps/mobile/src/components/__tests__/ui.test.tsx`.

**Interfaces (produz):**
- `theme.ts`:
  - `export const RADIUS = { card: 12, control: 10, pill: 999 }`
  - `export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }`
  - `export const FONT = { caption: 12, body: 14, bodyLg: 16, title: 20, display: 28 }`
  - `export const MIN_TOUCH = 48`
  - `export function contrastRatio(fg: string, bg: string): number` (fórmula WCAG de luminância relativa)
- `Theme` ganha `onSurfaceIcon` (= `muted`) e mais nada.
- `Button({ label, onPress, variant?: 'primary'|'secondary'|'danger'|'ghost', icon?: LucideIcon, disabled?, a11yLabel? })`: os chamadores atuais com `primary`/`danger` continuam funcionando por um adaptador em `ui.tsx` até a Task 8 removê-lo.
- `Field(props & { label; error?: string })`: mostra o erro abaixo, com `accessibilityRole="alert"`.
- `Chip({ label, selected, onPress, icon? })`
- `Card({ children, onPress?, a11yLabel? })`
- `ListItem({ title, subtitle?, left?, right?, onPress?, a11yLabel?, a11yActions? })`
- `Header({ title, right? })`
- `EmptyState({ icon, text })`
- `BottomSheet({ visible, onClose, title?, children, full?: boolean })`: `Modal` transparente + scrim (opacidade funcional, permitida pelo `UI_DESIGN.md`) + painel `surface` com raio 12 no topo; fecha com o voltar do Android.
- `Fab({ onPress, disabled, a11yLabel })`
- `Badge({ text, tone: 'neutral'|'green'|'red'|'attention'|'purple' })`
- `Snackbar({ message, actionLabel?, onAction?, visible })`

**Passos:**
- [ ] Passo 1: teste que falha.
  - `theme.test.ts`: "todo par texto/fundo passa 4,5:1" para `text`, `muted` × `bg`, `surface`, `field` nos dois temas, mais `onPrimary` × `primary`. "verde, vermelho, roxo e atenção passam 3:1 sobre `surface`" nos dois temas. `contrastRatio('#ffffff', '#000000')` ≈ 21.
  - `ui.test.tsx`:
    - `Button` com `disabled` tem `accessibilityState.disabled` true e não chama `onPress`.
    - `Button`, `Chip`, `Fab` e `ListItem` com `onPress` têm altura mínima `MIN_TOUCH`.
    - `Field` com `error="x"` mostra "x" como `alert`.
    - `BottomSheet` invisível não renderiza os filhos.
    - `Snackbar` com `actionLabel="Desfazer"` chama `onAction`.
    - `EmptyState` lê o `text`.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- theme ui`. Esperado: FALHA porque `contrastRatio` e os componentes não existem.
- [ ] Passo 3: implemente. Se algum token atual não passar no contraste, ajuste **só o token claro ou escuro que falhou**, para o tom mais próximo que passa, e anote o novo hex no commit.
- [ ] Passo 4: rode o mesmo comando e `npm run typecheck -w @sagyou/mobile`. Esperado: PASSA, e toda a suíte mobile continua verde (`npm test -w @sagyou/mobile`).
- [ ] Passo 5: commit `feat(mobile): design system com tokens e componentes base`.

### Task 2: Ícones, ícone do app e splash
*Tarefas do Sagyou: "Mobile: ícones (biblioteca, tab bar, ações, ícone do app e splash)" e "Mobile: usar o mesmo ícone do Sagyou do PC no celular".*

**Arquivos:**
- Criar `apps/mobile/scripts/make-icons.mjs`. Ele usa `sharp`, que já está no lockfile da raiz por causa do electron-builder; se não estiver, entra como `devDependency` do mobile.
- Gerar em `apps/mobile/assets/`: `icon.png` (1024), `android-icon-foreground.png` (1024, arte no centro em 66%), `android-icon-background.png` (1024, sólido `#0b0b0f`), `android-icon-monochrome.png` (1024, silhueta branca sobre transparente), `splash-icon.png` (1024), `favicon.png` (48).
- Modificar `apps/mobile/app.json`: plugin `expo-splash-screen` com `image: ./assets/splash-icon.png`, `backgroundColor: #0b0b0f`, `dark.backgroundColor: #0b0b0f`, `light.backgroundColor: #f5f4f1`, `imageWidth: 200`.
- Criar `apps/mobile/src/components/icons.ts`: os ícones do app, nomeados por uso.
- Teste: `apps/mobile/src/__tests__/app-config.test.ts` (já existe; ampliar) e `apps/mobile/src/components/__tests__/icons.test.ts`.

**Interfaces (produz):**
- `icons.ts`:
  - `export const TAB_ICONS: Record<'Tarefas'|'Hábitos'|'Finanças'|'Notas'|'Busca', LucideIcon>` (`ListChecks`, `Repeat`, `Wallet`, `StickyNote`, `Search`)
  - `export const ACTION_ICONS = { settings: Settings, add: Plus, task: SquareCheck, expense: ArrowDownCircle, income: ArrowUpCircle, note: StickyNote, check: Check, flame: Flame, calendar: Calendar, close: X, chevron: ChevronRight, offline: CloudOff, readOnly: Lock }`
  - `export function categoryIcon(category: string | undefined): LucideIcon`

**Passos:**
- [ ] Passo 1: teste que falha.
  - `app-config.test.ts`: `adaptiveIcon.backgroundColor === '#0b0b0f'`; os 6 arquivos de asset existem; o plugin `expo-splash-screen` está configurado com as cores acima; `android-icon-monochrome.png` não é igual ao primeiro plano (hash diferente).
  - `icons.test.ts`: `categoryIcon('Alimentação')` → `Utensils`; `'Aluguel'` → `Home`; `'Conta de Luz'` → `Zap`; `'Academia'` → `Dumbbell`; `'Assinaturas'` → `Repeat`; `'Curso'` → `GraduationCap`; `undefined`, `''` e `'Categoria Inventada'` → `Tag`. O mapa cobre pelo menos todas as categorias de `FINANCIAL_CATEGORIES` que começam com "Conta de", mais as 6 acima.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- app-config icons`. Esperado: FALHA (assets ainda são os do Expo; `icons.ts` não existe).
- [ ] Passo 3: rode `node apps/mobile/scripts/make-icons.mjs apps/desktop/build/icon.png` e implemente `icons.ts`. A silhueta monocromática é o alfa do primeiro plano, preenchido de branco.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): ícones, ícone do Sagyou e splash`.

### Task 3: Navegação, shell e criar rápido
*Tarefa do Sagyou: "Mobile: navegação e shell (tab bar, header, criar rápido)".*

**Arquivos:**
- Modificar `apps/mobile/src/App.tsx` e `apps/mobile/src/components/StatusBanner.tsx`.
- Criar:
  - `apps/mobile/src/store/quick.ts`: padrões puros do criar rápido.
  - `apps/mobile/src/store/undo.ts`: store do snackbar.
  - `apps/mobile/src/components/QuickCreate.tsx`: a folha "Criar" e as folhas enxutas de Tarefa e Nota.
  - `apps/mobile/src/components/TransactionSheet.tsx`: a folha de Gasto/Receita, que a Task 5 reusa na edição.
  - `apps/mobile/src/components/DateField.tsx`: chips "Hoje" / "Amanhã" / "Escolher data…" + seletor nativo, e "Sem prazo" quando `clearable`.
  - `apps/mobile/src/components/TabIcon.tsx`.
- Envolver a raiz com `GestureHandlerRootView`.
- Testes: `apps/mobile/src/__tests__/App.test.tsx` (ampliar), `apps/mobile/src/store/__tests__/quick.test.ts`, `apps/mobile/src/components/__tests__/QuickCreate.test.tsx`.

**Interfaces:**
- Consome: `createTask`, `latestOpenSprint`, `addTransaction`, `parseAmount`, `tablesOfProfile`, `lastTablePref`, `createNote`, componentes da Task 1, `TAB_ICONS`/`ACTION_ICONS` da Task 2.
- Produz:
  - `quick.ts`:
    - `export const PREF_QUICK_PROJECT = 'quick.lastProject'`
    - `export function quickProject(state: MobileState, pref: string | null): Project | undefined` (o pref se ativo; senão o primeiro ativo pela `order`)
    - `export function quickTaskTarget(state: MobileState, projectId: string): { columnId: string; sprintId?: string } | null` (primeira coluna por `order` que não é Done; senão a primeira; `null` se não há coluna; sprint = `latestOpenSprint`)
    - `export function quickTable(state: MobileState, profileId: string, pref: string | null): FinancialTable | undefined`
    - `export function dueChoice(choice: 'today'|'tomorrow', today: Date): string` (ISO local)
  - `undo.ts`:
    - `export const UNDO_MS = 5000`
    - `export const useUndo` (zustand) `{ message: string | null; canUndo: boolean; show(message: string, revert?: () => void): void; run(): void; dismiss(): void }`.
    - `show` substitui o anterior e agenda `dismiss` em `UNDO_MS`.
    - Sem `revert`, é só aviso: sem botão "Desfazer". É assim que aparece o `LOCKED_TEXT` da Task 5.
    - `run` chama `revert` uma vez só e fecha.
  - `QuickCreate({ visible, onClose })`
  - `TransactionSheet({ visible, onClose, type: 'income'|'expense', tx?: FinancialTransaction, tableId?: string })`:
    - Sem `tx`: tabela vem de `quickTable` com seletor; data padrão hoje.
    - Com `tx`: tabela fixa = `tableId`; campos preenchidos de `tx` (data = `tx.date`); salva por `updateTransaction`, como o `TransactionForm` atual.
    - Erro de `updateTransaction` aparece no `Field`.
  - `DateField({ label, value: string | undefined /* ISO */, onChange(iso: string | undefined): void, clearable?: boolean, today?: Date })`: rótulo do chip escolhido = `formatDateBR`.
  - `TabIcon({ label, color })`: renderiza `TAB_ICONS[label]` com `testID={'tab-icon-' + label}`.

**Passos:**
- [ ] Passo 1: teste que falha.
  - `quick.test.ts`:
    - pref de projeto arquivado → primeiro ativo;
    - pref inexistente → primeiro ativo;
    - sem projetos → `undefined`;
    - colunas `[Done(order 0), A Fazer(order 1)]` → `A Fazer`;
    - só `Done` → `Done`;
    - sem colunas → `null`;
    - sprint fechada ignorada;
    - `quickTable` com pref de outro perfil → primeira tabela do perfil;
    - `dueChoice('tomorrow', 2026-11-01 local)` → `'2026-11-02'`.
  - `undo.test.ts` (em `store/__tests__`): com fake timers, `show` + 5000 ms → `message` nulo; `run` duas vezes chama `revert` uma vez; segundo `show` troca a mensagem e o primeiro `revert` nunca roda.
  - `undo.test.ts` (complemento): `show('x')` sem `revert` → `canUndo` false.
  - `DateField.test.tsx` (em `components/__tests__`): "Amanhã" chama `onChange('2026-11-02')` com hoje 01/11; "Escolher data…" mostra `date-picker` e o `onChange` do picker com 15/11 grava `'2026-11-15'`; "Sem prazo" chama `onChange(undefined)`.
  - `App.test.tsx`:
    - as 5 abas têm rótulo e `tab-icon-<rótulo>`;
    - o (+) aparece por cima do `LockGate` só depois de desbloquear (com `getEnrolledLevelAsync` mockado e sem desbloquear, "Criar" não existe);
    - o botão "Ajustes" do header tem `accessibilityLabel` "Ajustes" e abre Ajustes;
    - o botão "Criar" aparece em Tarefas, Hábitos, Finanças e Notas e **não** em Busca;
    - com `readOnly`, "Criar" está desabilitado;
    - com `readOnly`, a faixa mostra `DISCONNECTED_TEXT`.
  - `QuickCreate.test.tsx`:
    - "Criar" abre as opções "Tarefa", "Gasto", "Receita", "Nota";
    - Tarefa: "Salvar" desabilitado com título vazio; com "Comprar pão" cria uma tarefa em `quickTaskTarget` e grava `quick.lastProject`;
    - chip "Amanhã" grava `dueDate` de amanhã;
    - Gasto: valor "abc" mostra `INVALID_AMOUNT_TEXT` e nada é gravado; "12,50" numa tabela BRL grava `amount: '12.5'`, `type: 'expense'` e a data de hoje, e grava `lastTablePref`;
    - fechar com texto digitado pergunta "Descartar?" (`Alert.alert` espionado); fechar vazio não pergunta;
    - com `readOnly`, "Salvar" de Tarefa, Gasto e Nota está desabilitado;
    - Nota usa `quick.lastProject` e grava ao salvar;
    - sem projetos, Tarefa mostra "Nenhum projeto ainda. Crie um no Sagyou do PC.".
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- quick undo DateField App QuickCreate`. Esperado: FALHA (módulos inexistentes, abas sem ícone).
- [ ] Passo 3: implemente. O (+) é um `Fab` absoluto renderizado pelo `TabsScreen`, que esconde quando a rota ativa é `Busca`. O `Snackbar` global fica acima da tab bar e lê `useUndo`. "Mais campos" na folha de Tarefa navega para `Tarefas › Tarefa` com `{ projectId, draftTitle }`; o `TaskForm` passa a aceitar `draftTitle?: string`.
- [ ] Passo 4: rode o mesmo comando e o typecheck. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): tab bar com ícones, ajustes no header e criar rápido`.

### Task 4: Tarefas
*Tarefa do Sagyou: "Mobile: redesenhar Tarefas (projetos, lista, Próximas, formulário)".*

**Arquivos:**
- Modificar `apps/mobile/src/screens/tasks/TaskLists.tsx`, `TaskForm.tsx`, `TasksStack.tsx` e `apps/mobile/src/store/tasks.ts`.
- Criar `apps/mobile/src/components/SwipeToComplete.tsx`. O `TaskForm` usa o `DateField` da Task 3 com `clearable`.
- Testes: `apps/mobile/src/store/__tests__/tasks.test.ts` (ampliar), `apps/mobile/src/screens/__tests__/Tasks.test.tsx` (ampliar), `apps/mobile/src/data/__tests__/records.test.ts` (ampliar).

**Interfaces:**
- Consome: `useUndo`, `quick.ts`, componentes e ícones.
- Produz em `store/tasks.ts`:
  - `export type UpcomingKey = 'overdue'|'today'|'tomorrow'|'week'|'later'`
  - `export const UPCOMING_SECTION_TITLES: Record<UpcomingKey, string> = { overdue: 'Atrasadas', today: 'Hoje', tomorrow: 'Amanhã', week: 'Esta semana', later: 'Mais tarde' }`
  - `export function upcomingSections(tasks: Task[], projects: Project[], today: string): { key: UpcomingKey; tasks: Task[] }[]` (sobre `upcomingTasks` do core; "Esta semana" = depois de amanhã até o domingo dessa semana; seções vazias omitidas)
  - `export function todaySummary(tasks: Task[], projects: Project[], today: string): { today: number; overdue: number }`
  - `export function todayText(s: { today: number; overdue: number }): string` → `"3 para hoje · 1 atrasada"`, `"2 atrasadas"`, `"1 para hoje"`, `"Nada vence hoje"`
  - `export function projectProgress(state: MobileState, projectId: string): { open: number; done: number; total: number }`
  - `export function revertCompletion(state: MobileState, before: Task, now: Date): MobileState` (devolve `columnId`, `order` e `completedAt` de `before` sobre a tarefa **atual**; o resto da tarefa atual fica)
  - `export const NO_DONE_COLUMN_TEXT = 'Este projeto não tem coluna Done.'`
  - Concluir pela tela:
    - se `completeTask` devolve o **mesmo** objeto de estado, mostra `NO_DONE_COLUMN_TEXT` como aviso (sem desfazer, sem vibrar) e não chama `commit`;
    - se `commit` devolve `false`, nada aparece;
    - só com `commit` verdadeiro: vibra e mostra "Tarefa concluída" + "Desfazer".

**Passos:**
- [ ] Passo 1: teste que falha.
  - `tasks.test.ts`, com hoje = quarta 2026-11-04:
    - prazos 03/11 → `overdue`; 04/11 → `today`; 05/11 → `tomorrow`; 06/11 e 08/11 (domingo) → `week`; 09/11 → `later`;
    - com hoje = domingo 2026-11-08, nenhuma `week` e 10/11 → `later`;
    - tarefa em Done fica fora;
    - `todayText` nos 4 casos acima;
    - `projectProgress` conta Done por `isDoneColumn`;
    - `revertCompletion`: a tarefa concluída e depois editada remotamente (título novo) volta à coluna, à `order` e ao `completedAt: undefined` de antes **e mantém o título novo**, mais `images` e `timeSpent`.
  - `Tasks.test.tsx`:
    - lista de projetos mostra o cartão "Hoje" com o `todayText`; tocar abre "Próximas";
    - cada projeto mostra `"<open> abertas"` e a barra com `accessibilityValue {min:0,max:total,now:done}`;
    - dentro do projeto, as colunas são chips com a contagem e a coluna Done fica por último;
    - prazo atrasado em vermelho e o de hoje em `attention` (estilo conferido pela cor do tema);
    - a ação de acessibilidade "Concluir" numa tarefa conclui a tarefa e mostra "Tarefa concluída" com "Desfazer"; "Desfazer" volta a tarefa à coluna original;
    - com `readOnly`, a ação "Concluir" não existe;
    - num projeto sem coluna Done, "Concluir" mostra `NO_DONE_COLUMN_TEXT`, não vibra e não grava versão;
    - os testes que tocavam "Concluir" e "Nova tarefa" são reescritos para a ação de acessibilidade e o (+);
    - Próximas mostra só as seções não vazias, com os títulos exatos;
    - `TaskForm` com `draftTitle="x"` começa com o título "x";
    - o prazo é escolhido pelos chips; "Sem prazo" limpa;
    - os testes atuais de sprint continuam passando.
  - `records.test.ts`: renderizar `ProjectList`, `ProjectBoard` e `UpcomingList` sobre um estado carregado do repo não gera versão nova.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- tasks Tasks records`. Esperado: FALHA.
- [ ] Passo 3: implemente. `SwipeToComplete` usa `Swipeable` do gesture-handler: soltar depois de 40% da largura conclui, chama `Haptics.impactAsync(Light)` e expõe `accessibilityActions=[{ name: 'concluir', label: 'Concluir' }]`. O formulário completo vira a tela da rota `Tarefa`, com apresentação `modal` do native-stack (folha de altura cheia).
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): Tarefas com resumo de hoje, Próximas agrupada e deslizar para concluir`.

### Task 5: Hábitos e Finanças
*Tarefa do Sagyou: "Mobile: redesenhar Hábitos e Finanças".*

**Arquivos:**
- Modificar `apps/mobile/src/screens/HabitsScreen.tsx`, `FinanceScreen.tsx`, `apps/mobile/src/store/habits.ts` e `finance.ts`.
- Criar `apps/mobile/src/components/Picker.tsx`: o seletor "Tabela ▸ X" / "Projeto ▸ X" que abre uma `BottomSheet` com rádios.
- Testes: `apps/mobile/src/screens/__tests__/Habits.test.tsx`, `Finance.test.tsx`, `apps/mobile/src/store/__tests__/finance.test.ts` (ampliar) e `habits.test.ts` (novo).

**Interfaces:**
- Produz:
  - `habits.ts`:
    - `export function todayDoneText(done: number, total: number): string` → `"3 de 5 hoje"`
    - `export function habitUndoText(marked: boolean): string` → `"Hábito marcado"` / `"Hábito desmarcado"`
    - `export function streakDaysText(streak: number): string` → `"1 dia"` / `"5 dias"`. Substitui `streakText`, que é removido junto com os testes que o usam (reescritos para `streakDaysText`).
  - `finance.ts`:
    - `export function monthSummary(txs: FinancialTransaction[], today: string): { income: string; expense: string }`: soma com `D()` todo o mês civil de `today`, inclusive lançamentos futuros já registrados, igual à lista (decisão do construtor). Retorna strings canônicas.
    - `export function groupByDay(txs: FinancialTransaction[], today: string): { day: string; label: string; txs: FinancialTransaction[] }[]`:
      - recebe a lista já filtrada pelo mês, como a tela faz hoje, e não filtra;
      - dias em ordem decrescente;
      - rótulos `"Hoje"`, `"Ontem"` ou `format(d, "EEE'.', dd/MM", { locale: ptBR })` → `"sex., 30/10"`.
  - `Picker<T>({ label, value, options: { id: string; label: string }[], onChange })`

**Passos:**
- [ ] Passo 1: teste que falha.
  - `habits.test.ts`: os 3 textos nos casos 0, 1 e 5.
  - `finance.test.ts`:
    - `monthSummary` com `['10.10','0.2']` de entrada e `['1500.5']` de saída em novembro, e um lançamento de outubro → `{ income: '10.3', expense: '1500.5' }`;
    - sem lançamentos → `'0'` e `'0'`;
    - `groupByDay` com hoje 2026-11-01 (domingo) → rótulos `Hoje`, `Ontem` (31/10), `sex., 30/10`.
  - `Habits.test.tsx`:
    - mostra "3 de 5 hoje";
    - o botão "Hoje" de "Ler" (`accessibilityRole="checkbox"`, label `"Ler, hoje"`) marca hoje, vibra (`expo-haptics` chamado) e mostra "Hábito marcado" + "Desfazer"; Desfazer desmarca;
    - os 7 dias da mini-semana continuam tocáveis;
    - com `readOnly`, nada muda.
  - `Finance.test.tsx`:
    - o seletor mostra "Tabela ▸ <nome>" e trocar grava `lastTablePref`;
    - o cartão mostra "Saldo atual", "Entradas do mês" e "Saídas do mês" com `formatCurrency`;
    - saldo negativo fica em `red`;
    - lançamentos agrupados sob "Hoje" / "Ontem";
    - a linha tem o ícone de `categoryIcon` (testID `cat-<categoria>`);
    - tocar num lançamento travado mostra `LOCKED_TEXT` no snackbar e não abre a edição;
    - os botões "Novo gasto" / "Nova receita" não existem mais; os testes que os usavam passam a abrir o `TransactionSheet` direto;
    - editar abre o `TransactionSheet` com `tx`: a data vem de `tx.date` e salvar grava por `updateTransaction`, como hoje.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- habits finance Habits Finance`. Esperado: FALHA.
- [ ] Passo 3: implemente. O `TransactionForm` atual sai e a edição usa o `TransactionSheet` da Task 3. O `LOCKED_TEXT` sai por `useUndo.show(LOCKED_TEXT)`, sem `revert`.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): Hábitos com marcar hoje e Finanças com resumo do mês`.

### Task 6: Notas, Busca, Ajustes, pareamento e bloqueio
*Tarefa do Sagyou: "Mobile: redesenhar Notas, Busca, Ajustes, pareamento e bloqueio".*

**Arquivos:**
- Modificar `apps/mobile/src/screens/NotesScreen.tsx`, `SearchScreen.tsx`, `SettingsScreen.tsx`, `PairScreen.tsx`, `apps/mobile/src/lock/LockGate.tsx`, `apps/mobile/src/store/notes.ts` e `apps/mobile/src/data/search.ts` (só tipos/exports; a SQL não muda).
- Criar `apps/mobile/src/store/highlight.ts`.
- Testes: `Notes.test.tsx`, `PairScreen.test.tsx`, `SettingsScreen.test.tsx`, `LockGate.test.tsx` (ampliar), `apps/mobile/src/screens/__tests__/Search.test.tsx` (novo) e `apps/mobile/src/store/__tests__/highlight.test.ts` (novo).

**Interfaces:**
- Produz:
  - `highlight.ts`: `export function highlightParts(title: string, query: string): { text: string; match: boolean }[]`. Ignora caixa e acento comparando **caractere a caractere** (cada caractere dobrado com NFD sem marcas), então os trechos devolvidos são fatias do título original. Cada palavra da busca com 2+ letras é destacada.
  - `notes.ts`: `export function editedText(iso: string, now: Date): string` → `"editada agora"` (< 1 min) ou `"editada há " + formatDistanceStrict(..., { locale: ptBR })`.
  - `SEARCH_GROUP_ORDER: SearchKind[] = ['task','project','note','habit','transaction']` e `SEARCH_GROUP_TITLES = { task: 'Tarefas', project: 'Projetos', note: 'Notas', habit: 'Hábitos', transaction: 'Lançamentos' }` em `SearchScreen.tsx`.
  - `PAIR_STEPS = ['Boas-vindas', 'No PC', 'Conectando']` e os textos exatos da spec: `WELCOME_TEXT = 'Leve suas tarefas, hábitos e finanças no bolso'` e `ON_PC_TEXT = 'Abra Configurações → Sincronização → Parear novo aparelho no Sagyou do PC'`.
  - `LOCKED_TITLE = 'Sagyou bloqueado'` em `lock/texts.ts`.

**Passos:**
- [ ] Passo 1: teste que falha.
  - `highlight.test.ts`:
    - `highlightParts('Conta de Luz', 'luz')` → `[{Conta de ,false},{Luz,true}]`;
    - `('Hábito diário', 'habito')` → o trecho destacado é `'Hábito'`;
    - query vazia → `[{title,false}]`;
    - palavra de 1 letra é ignorada.
  - `Search.test.tsx`:
    - sem texto mostra "Busque tarefas, notas, hábitos e lançamentos";
    - com hits de tarefa e nota, os grupos aparecem na ordem `SEARCH_GROUP_ORDER` com os títulos e contagens ("Tarefas · 2");
    - sem hit mostra `Nada encontrado para "xyz"`;
    - o botão "Limpar busca" zera o campo;
    - tocar num hit chama `onOpen` com o hit.
  - `Notes.test.tsx`:
    - seletor "Projeto ▸ X" começa em `quickProject(state, quick.lastProject)` e trocar grava `quick.lastProject` (uma chave só para tarefa e nota rápidas, decisão do construtor);
    - cartão com "editada há 2 horas" (relógio fixo);
    - "Nova nota" não existe mais na tela (vem do +);
    - editar e salvar continua.
  - `SettingsScreen.test.tsx`:
    - seções na ordem "Este aparelho", "Sincronização", "Perfil financeiro", "Zona de perigo";
    - `DISCONNECT_LABEL` fica dentro de "Zona de perigo";
    - perfil é `radio` com `checked`.
  - `PairScreen.test.tsx`:
    - começa no passo "1 de 3" com `WELCOME_TEXT`;
    - "Começar" → "2 de 3" com `ON_PC_TEXT`, "Ler QR" e "Colar código";
    - os erros atuais (`EXPIRED_TEXT`, `PAIR_FAILED_TEXT`, `DOWNLOAD_FAILED_TEXT`) e o fluxo de `resume('take-cloud')` continuam passando.
  - `LockGate.test.tsx`: bloqueado mostra `LOCKED_TITLE` e "Desbloquear"; sem bloqueio no aparelho mantém `NO_DEVICE_LOCK_TEXT`; os testes atuais de 5 min continuam.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- highlight Search Notes Settings Pair LockGate`. Esperado: FALHA.
- [ ] Passo 3: implemente. Ajustes reserva o lugar do cartão de versão com o comentário `{/* Versão do app: spec mobile-releases */}`, sem renderizar nada.
- [ ] Passo 4: rode o mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): Notas, Busca, Ajustes, pareamento e bloqueio com o visual novo`.

### Task 7: Estados, microinterações e acessibilidade
*Tarefa do Sagyou: "Mobile: estados, microinterações e acessibilidade".*

**Arquivos:**
- Criar `apps/mobile/src/components/Skeleton.tsx` e `apps/mobile/src/hooks/useReducedMotion.ts`.
- Modificar `App.tsx` (tela de carregando com o ícone), as telas que ainda mostram texto vazio solto (passam a `EmptyState`), `BottomSheet`, `Snackbar` e `SwipeToComplete` (respeitam movimento reduzido), e `apps/mobile/src/components/ui.tsx` (remove o adaptador `primary`/`danger` da Task 1).
- Teste: `apps/mobile/src/__tests__/a11y.test.tsx` (novo) e `App.test.tsx`.

**Interfaces:**
- Produz:
  - `useReducedMotion(): boolean` (`AccessibilityInfo.isReduceMotionEnabled` + listener `reduceMotionChanged`)
  - `Skeleton({ lines: number })`: blocos `selected`; anima a opacidade 1 → 0,6 em 800 ms só sem movimento reduzido.
  - `export function awaitingFirstSync(status: SyncStatus | null): boolean` em `store/app.ts` → `status === null || status.lastSyncAt === null`.
  - Gatilho (decisão do construtor): Tarefas (lista de projetos), Hábitos, Finanças e Notas mostram `Skeleton lines={4}` **no lugar** do `EmptyState` quando a lista está vazia **e** `awaitingFirstSync(status)`. Com a primeira sincronização feita, lista vazia mostra o `EmptyState`.

**Passos:**
- [ ] Passo 1: teste que falha.
  - `a11y.test.tsx`: para cada tela (Tarefas, Próximas, Hábitos, Finanças, Notas, Busca, Ajustes) renderizada com dados de exemplo:
    - todo elemento com `accessibilityRole` button, checkbox, radio ou tab tem `accessibilityLabel` não vazio;
    - todo `Pressable` tem `minHeight`/`height` ≥ `MIN_TOUCH`;
    - todo `Text` não usa `allowFontScaling={false}`;
    - com estado vazio e `status.lastSyncAt` preenchido, cada tela mostra o `EmptyState` com o texto atual dela;
    - com estado vazio e `status.lastSyncAt === null`, Tarefas, Hábitos, Finanças e Notas mostram o skeleton (`testID="skeleton"`) e não o `EmptyState`.
  - `App.test.tsx`:
    - `mode === 'loading'` mostra o ícone com label "Carregando o Sagyou";
    - com `isReduceMotionEnabled` → true, `BottomSheet` abre com `animationType="none"`.
- [ ] Passo 2: rode `npm test -w @sagyou/mobile -- a11y App`. Esperado: FALHA.
- [ ] Passo 3: implemente e corrija o que a varredura apontar.
- [ ] Passo 4: rode `npm test -w @sagyou/mobile` (suíte mobile inteira) e o typecheck. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mobile): estados vazio e carregando, movimento reduzido e varredura de acessibilidade`.

### Task 8: Suíte completa, APK, docs e PR

**Arquivos:**
- Modificar `CLAUDE.md` (seção `apps/mobile`: design system, componentes, `store/quick.ts`/`undo.ts`, pref `quick.lastProject`, dependências nativas novas e mocks do Jest).
- Modificar `GUIDE.md` (resumo curto das mesmas regras que mordem: tokens só do `theme.ts`, desfazer por `revertCompletion`, alvo de 48 dp).
- Modificar `README.md` (seção "App Android": prints novos se houver; avisar que o APK precisa ser reinstalado por causa das bibliotecas nativas).

**Passos:**
- [ ] Passo 1: rode `npm run typecheck` e `npm test` na raiz, e `npm run lint`.
  - Esperado: typecheck e testes verdes, e `records.test.ts` (zero versões ao carregar e salvar sem editar) passando.
  - O lint não pode ter erro novo nos arquivos desta branch. A dívida histórica fora do diff não conta, como no CI.
- [ ] Passo 2: dê push da branch e dispare `mobile-apk.yml` manualmente nela (`gh workflow run mobile-apk.yml --ref feature/mobile-design-ux`), acompanhando com `gh run watch`. Esperado: APK gerado.
- [ ] Passo 3: Luis instala o APK e confere no aparelho os passos da spec: (+) → Gasto em 2 toques; deslizar conclui e Desfazer volta; tema claro e escuro; fonte do sistema em 200%; TalkBack lê as abas e o (+); "Remover animações" ligado; ícone temático no Android 13+. O que falhar volta como fix na branch.
- [ ] Passo 4: atualize `CLAUDE.md`, `GUIDE.md` e `README.md`; commit `docs(mobile-design-ux): design system e telas novas`.
- [ ] Passo 5: `/sagyou-review` (com `sagyou-ui-reviewer`) e `/sagyou-pr`.
