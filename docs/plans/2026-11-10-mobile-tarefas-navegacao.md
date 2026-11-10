# Plano de implementação: Celular — tarefas por coluna, filtros e busca no cabeçalho

Status: approved by Luis on 2026-11-10
Spec: docs/specs/2026-11-10-mobile-tarefas-navegacao.md
Branch: feature/mobile-tarefas-navegacao

**Objetivo:** na aba Tarefas do celular, concluir só por caixinha, ver o projeto inteiro em seções com filtros lembrados, ver todas as tarefas abertas, e tirar a Busca da barra de baixo.

**Arquitetura:**
- Regra pura e testável em `apps/mobile/src/store/taskFilters.ts`: filtros, seções, opções, rótulos e leitura/gravação em `prefs`.
- As telas em `screens/tasks/` só desenham o que esse módulo devolve.
- A Busca vira uma tela do stack raiz (`Busca`), aberta por uma lupa no `headerRight` das abas.

## Restrições Globais

- Testes **não rodam no PC** (pedido do Luis em 2026-10-31): cada task faz commit de teste + código, push na branch, e o resultado vem do CI do PR (`gh pr checks <n> --watch`).
  - O PR abre como rascunho na Task 1.
  - Typecheck local (`npm run typecheck -w @sagyou/mobile`) é permitido; não é teste.
- Textos exatos:
  - "Concluir <título>", "Tarefa concluída", "Este projeto não tem coluna Done." (os dois últimos já existem).
  - Rótulos dos chips: "Sprint: <nome>", "Prioridade: <…>", "Tag: <…>"; sem filtro, "Sprint: Todas", "Prioridade: Todas", "Tag: Todas".
  - Opções de Sprint: "Todas", "Sem sprint" e as sprints abertas. Opções de Prioridade: "Todas", "Urgente", "Alta", "Média", "Baixa". Opções de Tag: "Todas" e as tags.
  - Cabeçalho de seção: "<coluna> (<n>)". Dentro de uma seção vazia: "Nenhuma tarefa aqui.".
  - Nada passa nos filtros: "Nenhuma tarefa com estes filtros." + "Limpar filtros". Sem tarefas abertas: "Nenhuma tarefa aberta.".
  - Botão da seção: "Nova tarefa em <coluna>". Cartão: "Todas as tarefas", com "<n> abertas" / "1 aberta". Título da tela: "Todas as tarefas".
  - Lupa: rótulo "Buscar"; tela "Busca".
- Prefs: `tasks.filter.<projectId>` e `tasks.filter.all`, JSON `{ "sprint": "<id>|all|none", "priority": "<p>|all", "tag": "<tag>|all" }`. Device-only, nunca sincronizado, já apagado no wipe.
- Nenhum gesto horizontal conclui nada; `SwipeToComplete` e o mock de `ReanimatedSwipeable` no `jest.setup.js` saem.
- Alvos de 48 dp (`MIN_TOUCH`), cores só de `theme.ts`, componentes de `ui.tsx`, e `a11y.test.tsx` cobrindo as telas novas.
- Versão do celular: MINOR (0.6.0 → 0.7.0; se o PR #59 entrar antes, 0.8.0, com `versionCode` 800). Desktop não muda.

## Decisões do construtor (da checagem do plano)

- **Caixinha separada da linha:** em `TaskRow`, uma `View` em linha com dois irmãos: um `Pressable` da caixinha (48 × 48, `accessibilityRole="checkbox"`) e o `ListItem` (flex 1). Assim o TalkBack foca os dois separados. A bandeira de prioridade continua no `left` do `ListItem`. `ListItem.tsx` não muda.
- **Valor lembrado inválido**, como diz a spec, campo a campo:
  - sem pref nenhuma → `defaultFilter`;
  - JSON ilegível → `ALL_FILTER`;
  - campo ausente ou de tipo errado → 'all' naquele campo;
  - sprint que não é aberta deste projeto (encerrada ou apagada) → a sprint padrão (`latestOpenSprint`, ou 'all');
  - tag fora de `tagOptions` do escopo → 'all';
  - prioridade fora das quatro → 'all'.
- **Contadores:**
  - "<coluna> (<n>)" e "<projeto> (<n>)" contam as tarefas que passam nos filtros;
  - o cartão "Todas as tarefas" conta as abertas sem filtro;
  - o cartão Hoje continua como está.
- **Tags oferecidas:**
  - no projeto, todas as tarefas do projeto, inclusive as da Done (os filtros valem para Done);
  - em Todas, as tarefas abertas de projetos não arquivados.

  A tag lembrada é validada contra esse mesmo conjunto.
- **(+) com a Busca aberta:** a aba fica coberta pela tela do stack raiz. O teste afirma dentro da árvore da Busca (`testID="search-screen"`) que não há "Criar". Não muda código do (+).
- **Rótulo "Buscar":** a lupa é `button` e o campo é `TextInput`, ambos com rótulo "Buscar". Nos testes do App, busca por papel (`getByRole('button', { name: 'Buscar' })`). `SearchScreen` já tem `autoFocus`, então não ganha prop.
- **Rota de Todas:** `ALL_TASKS_TITLE = 'Todas as tarefas'` (exportada de `TaskLists.tsx`), usada como nome da rota em `TasksParams`, como `UPCOMING_TITLE`. `onAll` é obrigatório em `ProjectList`, e as chamadas em `Tasks.test.tsx` e `a11y.test.tsx` passam `jest.fn()`.
- **`FilterBar`:**
  - `FilterBar({ filter, onChange, kinds, scope })`, com `kinds: readonly ('sprint' | 'priority' | 'tag')[]` e `scope: { projectId: string | null; tasks: Task[] }`;
  - o chip de Sprint só aparece quando `kinds` o inclui, e Todas passa `['priority', 'tag']`;
  - `sprintOptions(state, projectId: string)` só é chamado com projeto.
- **Seção Done:** recolhida ao abrir. Aberta e vazia, mostra "Nenhuma tarefa aqui.". Não tem botão de nova tarefa.
- **Só leitura:** "Nova tarefa em <coluna>" desabilitado, como o botão de hoje.
- **Wipe:** `runtime.wipeLocal` já roda `DELETE FROM prefs` (`sync/runtime.ts:82`) e tem teste em `sync/__tests__/runtime.test.ts`. Não precisa de teste novo.

## Foco de Review

1. **Conclusão sem querer.** Rolar ou arrastar uma linha para o lado não conclui; só a caixinha (ou a ação de acessibilidade "concluir") conclui, com Desfazer. Modo só leitura: caixinha desabilitada, nada gravado. Testado na Task 2.
2. **Pref lembrada que não vale mais.** Sprint encerrada ou apagada, tag sumida ou JSON ilegível em `tasks.filter.*` segue a regra campo a campo de "Decisões do construtor" (ilegível → Todas; sprint inválida → sprint padrão), sem quebrar a tela nem esconder tarefas para sempre. Testado na Task 1.
3. **Filtro que esconde tudo.** Com filtros que não casam nada, aparece "Nenhuma tarefa com estes filtros." e "Limpar filtros" volta tudo para "Todas" e grava isso. Testado nas Tasks 1 e 3.
4. **Busca fora da barra.** O resultado de busca ainda abre a tarefa, o projeto, a nota, o hábito e a transação certos a partir da tela do stack raiz (navegação aninhada `Abas › Tarefas › Tarefa/Projeto`, `Abas › Notas` …). O (+) não aparece na Busca. Testado na Task 5.
5. **Dados existentes.** Nada sincronizado muda. Um aparelho sem nenhuma pref nova abre com os padrões, e o wipe continua apagando as prefs novas junto com as outras (teste existente em `sync/__tests__/runtime.test.ts`). Padrões testados na Task 1.

### Task 1: regras de filtro e seções (store puro)

**Arquivos:**
- Criar `apps/mobile/src/store/taskFilters.ts`.
- Teste: `apps/mobile/src/store/__tests__/taskFilters.test.ts`.

**Interfaces:**
- Consome: `MobileState` (`data/state`), `latestOpenSprint` (`@sagyou/core/sprints`), `isDoneColumn` (`@sagyou/core/columns`), `PRIORITY_LABELS` (`store/tasks`), `RecordRepo['readPref' | 'writePref']`.
- Produz:
  ```ts
  export interface TaskFilter { sprint: 'all' | 'none' | string; priority: 'all' | Priority; tag: 'all' | string }
  export const ALL_FILTER: TaskFilter            // { sprint:'all', priority:'all', tag:'all' }
  export const filterKey: (projectId: string | null) => string   // tasks.filter.<id> | tasks.filter.all
  export function defaultFilter(state: MobileState, projectId: string | null): TaskFilter
  export function readFilter(repo, state, projectId: string | null): TaskFilter     // normaliza
  export function writeFilter(repo, projectId: string | null, filter: TaskFilter): void
  export function matchesFilter(task: Task, filter: TaskFilter): boolean
  export function boardSections(state, projectId, filter): { column: Column; tasks: Task[]; done: boolean }[]
  export function allTaskSections(state, filter): { project: Project; tasks: Task[] }[]
  export function sprintOptions(state, projectId): { value: string; label: string }[]
  export function priorityOptions(): { value: string; label: string }[]
  export function tagOptions(tasks: Task[]): { value: string; label: string }[]
  export function filterChipLabel(kind: 'sprint' | 'priority' | 'tag', filter, state): string
  export function openCountText(n: number): string           // "1 aberta" / "<n> abertas"
  export const TASK_FILTER_TEXTS = { noneHere, noMatch, clear, noOpen, allTitle, newIn(col) }
  ```
- [ ] Passo 1: testes:
  - `defaultFilter` escolhe a sprint aberta mais recente (ou 'all' sem sprint aberta; `null` → `ALL_FILTER`).
  - `readFilter` devolve o padrão sem pref, e cai no padrão daquele campo com JSON ilegível, sprint encerrada ou apagada, ou tag que não existe mais nas tarefas do escopo.
  - `writeFilter` + `readFilter` fazem o caminho de ida e volta.
  - `matchesFilter` cobre 'none' (task sem `sprintId`), prioridade e tag.
  - `boardSections` segue a ordem do quadro com Done no fim, ordena as tarefas por `order` e aplica o filtro em todas as seções.
  - `allTaskSections` pula projetos arquivados, mostra só tarefas fora de colunas Done, segue a ordem dos projetos e omite projeto sem tarefa.
  - `sprintOptions` = ["Todas", "Sem sprint", abertas da mais nova para a mais antiga].
  - `tagOptions` vem em ordem alfabética e sem repetição.
  - `filterChipLabel` produz "Sprint: Todas", "Sprint: Sem sprint", "Sprint: <nome>", "Prioridade: Alta", "Tag: casa".
  - `openCountText(1)` = "1 aberta" e `openCountText(12)` = "12 abertas".
- [ ] Passo 2: implementar; typecheck local.
- [ ] Passo 3: commit `feat(mobile): regras de filtro e seções das tarefas` (teste + código); push; abrir o PR rascunho `feat(mobile): tarefas por coluna, filtros e busca no cabeçalho`. Esperado no CI: `taskFilters.test.ts` passa.

### Task 2: caixinha de concluir no lugar do arrastar

**Arquivos:**
- Modificar `apps/mobile/src/screens/tasks/TaskLists.tsx` (`TaskRow`) e `apps/mobile/jest.setup.js` (remove o mock de `ReanimatedSwipeable`).
- Remover `apps/mobile/src/components/SwipeToComplete.tsx`.
- Teste: `apps/mobile/src/screens/__tests__/Tasks.test.tsx`.

**Interfaces:**
- Produz `TaskRow` com `checkbox` (`accessibilityRole="checkbox"`, `accessibilityLabel="Concluir <título>"`, `accessibilityState={{ checked: false, disabled: readOnly }}`, 48 dp), que chama `completeFromList`. Sem caixinha quando `done`.
- [ ] Passo 1: testes:
  - Tocar "Concluir Pagar conta" move a tarefa para Done e mostra "Tarefa concluída" com Desfazer.
  - Com `readOnly`, a caixinha fica desabilitada e nada é gravado.
  - A ação de acessibilidade "concluir" continua funcionando.
  - Nenhum `testID="swipeable"` na árvore.
  - Linha de tarefa já concluída não tem caixinha.
  - Próximas também mostra a caixinha.
  - Ajustar os testes antigos que concluíam pelo swipe.
- [ ] Passo 2: implementar; remover o componente e o mock. Rodar `grep -rn SwipeToComplete apps/mobile/src` → vazio.
- [ ] Passo 3: commit `feat(mobile): concluir tarefa pela caixinha, sem arrastar`; push; CI verde.

### Task 3: projeto com seções por coluna e barra de filtros

**Arquivos:**
- Criar `apps/mobile/src/screens/tasks/FilterBar.tsx`.
- Modificar `ProjectBoard` em `TaskLists.tsx`.
- Teste: `Tasks.test.tsx`.

**Interfaces:**
- Consome a Task 1.
- Produz `FilterBar({ filter, onChange, kinds, state, projectId })`: chips e `BottomSheet` com as opções em `accessibilityRole="radio"`.
- `ProjectBoard` lê o filtro com `readFilter(services.repo, …)` uma vez e grava com `writeFilter` a cada troca.
- [ ] Passo 1: testes:
  - O projeto abre na sprint aberta mais recente: o chip diz "Sprint: <nome>" e tarefas de outra sprint não aparecem.
  - Escolher "Prioridade › Alta" filtra e grava `tasks.filter.p1`; remontar mantém o filtro.
  - As seções aparecem como "Backlog (2)" etc., com Done por último e recolhida (`expanded: false`); tocar no cabeçalho alterna.
  - Seção vazia mostra "Nenhuma tarefa aqui."; filtros sem resultado mostram "Nenhuma tarefa com estes filtros." e "Limpar filtros" volta para "Todas".
  - "Nova tarefa em Backlog" chama `onNewTask('<id>')`, e não existe esse botão na seção Done.
  - Os chips de coluna antigos não existem mais.
  - Reescrever os testes de `ProjectBoard` que dependiam dos chips. Nas fixtures de `Tasks.test.tsx`, as tarefas ganham `sprintId` da sprint aberta mais recente (ou o teste grava `tasks.filter.p1` = Todas), para que o filtro padrão não as esconda.
- [ ] Passo 2: implementar.
- [ ] Passo 3: commit `feat(mobile): projeto com seções por coluna e filtros`; push; CI verde.

### Task 4: Todas as tarefas

**Arquivos:**
- Modificar `TaskLists.tsx`: `ProjectList` ganha o cartão; criar `AllTasksList`.
- Modificar `TasksStack.tsx`: rota `Todas`, título "Todas as tarefas".
- Modificar `apps/mobile/src/__tests__/a11y.test.tsx`.
- Teste: `Tasks.test.tsx`.

**Interfaces:**
- `ProjectList({ onOpen, onUpcoming, onAll, today })`.
- `AllTasksList({ onOpenTask(projectId, taskId), today })`.
- [ ] Passo 1: testes:
  - O cartão mostra "Todas as tarefas" e "<n> abertas" e chama `onAll`.
  - A tela agrupa por projeto (cabeçalho "<projeto> (<n>)"), sem tarefas concluídas nem projetos arquivados.
  - Os filtros de Prioridade e Tag existem, e o de Sprint não; o filtro é gravado em `tasks.filter.all`.
  - "Nenhuma tarefa aberta." aparece sem tarefas.
  - O a11y cobre 'Todas as tarefas', com a entrada adicionada **no fim** de `SCREENS` (a lista `EMPTY` usa índices).
- [ ] Passo 2: implementar.
- [ ] Passo 3: commit `feat(mobile): todas as tarefas agrupadas por projeto`; push; CI verde.

### Task 5: Busca no cabeçalho

**Arquivos:**
- Modificar `apps/mobile/src/App.tsx`:
  - `TAB_LABELS` sem 'Busca';
  - `RootStackParams.Busca: undefined`;
  - `SearchRoute`, que navega `Abas › Tarefas › Tarefa/Projeto` e `Abas › Notas/Hábitos/Finanças`;
  - `headerRight` com a lupa "Buscar" e a engrenagem;
  - `FAB_TABS` sem mudança.
- Modificar `components/icons.ts` (`TabLabel` sem 'Busca'; ícone `search` continua em `ACTION_ICONS`).
- Modificar `screens/SearchScreen.tsx` (só `testID="search-screen"` no contêiner).
- Testes: `apps/mobile/src/__tests__/App.test.tsx` e `components/__tests__/icons.test.ts`. A entrada 'Busca' do `a11y.test.tsx` já existe e fica como está.
- [ ] Passo 1: testes:
  - `TAB_LABELS` = ['Tarefas', 'Hábitos', 'Finanças', 'Notas'].
  - Não existe `tab-Busca`.
  - O botão "Buscar" no cabeçalho abre a tela Busca.
  - Tocar um resultado de tarefa abre o formulário dela na aba Tarefas, e um de projeto abre o projeto.
  - Nota, hábito e transação abrem as abas Notas, Hábitos e Finanças.
  - Dentro de `search-screen` não há "Criar".
  - `components/__tests__/icons.test.ts` sem 'Busca' na lista de abas; "mostra as cinco abas" do `App.test.tsx` renomeado.
  - Trocar o teste antigo "o (+) some na Busca".
- [ ] Passo 2: implementar.
- [ ] Passo 3: commit `feat(mobile): busca no cabeçalho, fora da barra de baixo`; push; CI verde.

### Task 6: docs, versão, review e PR

**Arquivos:**
- `CLAUDE.md` (bloco do mobile: `SwipeToComplete` sai, caixinha, seções e filtros, prefs `tasks.filter.*`, Busca no stack raiz).
- `GUIDE.md` (se citar a aba Busca ou o arrastar).
- `README.md` (seção do App Android).
- `apps/mobile/app.json`, `apps/mobile/package.json` e `package-lock.json` (versão).
- [ ] Passo 1: atualizar docs e versão (MINOR; conferir se o PR #59 já entrou).
- [ ] Passo 2: push; CI verde (typecheck, testes, lint das linhas alteradas).
- [ ] Passo 3: APK pelo `mobile-apk.yml` na branch, se o Luis quiser testar no aparelho:
  - rolar a lista para o lado não conclui;
  - caixinha com TalkBack;
  - filtros lembrados depois de fechar o app;
  - lupa no cabeçalho;
  - fonte em 200%.
- [ ] Passo 4: `/sagyou-review` (geral + UI) e `/sagyou-pr`: tirar o PR de rascunho.
