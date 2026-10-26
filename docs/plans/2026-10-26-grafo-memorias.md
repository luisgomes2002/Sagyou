# Plano de implementação: Memórias no grafo e fim dos nós soltos

Status: approved by Luis on 2026-10-26
Spec: docs/specs/2026-10-26-grafo-memorias.md
Branch: feature/grafo-memorias

**Objetivo:** mostrar memórias ativas no grafo, ligadas a projetos, ao nó Geral e entre si por tags, sem deixar nenhum nó solto, com paleta sóbria.

**Arquitetura:** `buildGraph` (`utils/graph-layout.ts`) continua puro e ganha um 7º parâmetro opcional `memories`, um nó `general` e o tipo de aresta `tag`. `GraphView` lê as memórias por `window.electronAPI.ai.memory.list()` ao montar (fora do Zustand) e repassa ao `buildGraph`. `App.tsx` trata o novo `NavigateTarget` de memória reaproveitando `searchTargetId` do `MemoryView`.

## Restrições Globais

- Sem mudança de dados: nada novo em SQLite, backup, `ai-config.json` ou MCP.
- Memórias: só ativas (`ai:memory:list` sem `includeArchived` já exclui arquivadas; o filtro `archivedAt == null` é repetido no `buildGraph` por defesa).
- Ligações por tag: no máximo **3** por memória; handoffs (`type === 'handoff'`) ficam fora; tags comparadas com `trim().toLowerCase()`; tags vazias ignoradas.
- O nó Geral só existe se algo se liga a ele. Rótulo exato: `Geral`.
- Paleta exata (spec): projeto `#7d6fc0`, task `#5b84b8`, task concluída `#3d5878`, nota `#c09a4a`, nota concluída `#7f6732`, meta `#b86a8e`, hábito `#4f9a6c`, arquivo `#b87a4a`, memória `#5a9ea0`, Geral `#8a8a94`, aresta explícita/seta `#6d5bb8`, aresta por tag `#4a7a7c`, foco da busca `#6d5bb8`, aresta estrutural `#555` (sem mudança).
- Textos exatos: legenda `Memória`, `Geral`; tooltip `Memória`/`Geral`; estado vazio `Crie projetos, tasks, notas, adicione arquivos ou salve memórias`; falha `Não foi possível carregar as memórias.`
- `GraphView` preserva `positionsRef` ao recriar o grafo (GUIDE.md); a chegada assíncrona das memórias recria `nodes` e não pode resetar posições já calculadas. Por isso os ids de nó passam a ser **estáveis por entidade**: `${type}:${entityId}` (ex.: `task:abc`), e o Geral é `general:general`. Os ids sequenciais `n0, n1…` deixam de existir (decisão do construtor; feito na Task 2).
- "Nenhum nó solto" vale também para projeto sem itens: ele se liga ao Geral com aresta `structural` (cumpre a spec ao pé da letra).
- Sem `shadow`/glow colorido, sem `animate-pulse`, sem preenchimento com opacidade baixa.

## Foco de Review

1. **Base com dados reais e sem memória nenhuma** (usuário que nunca usou agente): o grafo continua idêntico em forma, exceto que hábitos/metas/arquivos sem projeto agora se prendem ao Geral. Testado na Task 2.
2. **Memória de projeto removido** (`projectId` sem projeto, estado real documentado em CLAUDE.md como "projeto removido"): liga-se ao Geral, não some nem fica solta. Testado na Task 3.
3. **Tag muito comum** (ex.: 40 memórias com tag `electron`): nenhuma memória passa de 3 arestas `tag`, sem duplicatas nem laços. Testado na Task 3.
4. **`ai:memory:list` rejeita** (app bloqueado, IPC indisponível no teste): o grafo renderiza o resto e mostra o aviso no rodapé, sem lançar erro. Testado na Task 4.
5. **Meta sem projeto** deixa de ir ao primeiro projeto: aresta vai ao Geral e nenhuma aresta liga a meta a um projeto alheio. Testado na Task 2.

### Task 1: Paleta sóbria no grafo

**Arquivos:** Modificar `src/renderer/src/utils/graph-layout.ts`, `src/renderer/src/components/views/GraphView.tsx`. Teste `src/renderer/src/__tests__/utils/graph-layout.test.ts`, `src/renderer/src/__tests__/components/GraphView.test.tsx`.
**Interfaces:** Produz `GRAPH_NODE_COLORS` com os novos valores (chaves `memory` e `general` entram na Task 2/3).

- [ ] Passo 1: no `graph-layout.test.ts`, novo teste `usa a paleta sóbria` afirmando `GRAPH_NODE_COLORS` = `{ project: '#7d6fc0', task: '#5b84b8', note: '#c09a4a', goal: '#b86a8e', habit: '#4f9a6c', file: '#b87a4a' }` (via `toMatchObject`) e mudar o teste de concluídos para `#3d5878` e `#7f6732`.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/utils/graph-layout.test.ts`. Esperado: FALHA (cores antigas).
- [ ] Passo 3: trocar `NODE_COLOR` e `COMPLETED_NODE_COLOR`. Em `GraphView.tsx`: `#7c3aed` → `#6d5bb8` (aresta explícita, seta e `focus:border`), remover `opacity="0.7"` da seta. Atualizar as cores do mock em `GraphView.test.tsx` para os novos valores.
- [ ] Passo 4: `npx vitest run src/renderer/src/__tests__/utils/graph-layout.test.ts src/renderer/src/__tests__/components/GraphView.test.tsx`. Esperado: PASSA.
- [ ] Passo 5: commit `style(grafo): paleta sóbria nos nós e arestas`.

### Task 2: Nó Geral e fim dos nós soltos

**Arquivos:** Modificar `src/renderer/src/utils/graph-layout.ts`. Teste `src/renderer/src/__tests__/utils/graph-layout.test.ts`.
**Interfaces:** Produz `GraphNodeType` com `'general'`; `GRAPH_NODE_COLORS.general = '#8a8a94'`; exporta `GENERAL_NODE_ENTITY_ID = 'general'`. Nó Geral: `{ type: 'general', label: 'Geral', entityId: 'general', base radius 20 }`.

- [ ] Passo 1: testes que falham:
  - `liga hábitos ao nó Geral sem ligá-los entre si` (substitui `não inventa ligações entre hábitos independentes`): 2 hábitos → existe 1 nó `general` com label `Geral`; `edges` = 2 arestas `structural` hábito→Geral; nenhuma aresta hábito↔hábito.
  - `liga meta sem projeto ao Geral e não ao primeiro projeto`: projeto + meta sem `projectId` → aresta meta→Geral; nenhuma aresta meta→projeto.
  - `liga meta e arquivo de projeto removido ao Geral`: `projectId: 'missing'`.
  - o teste de arquivos passa a esperar arquivo global → Geral (`structural`).
  - `não cria o nó Geral quando nada depende dele`: só projeto + task → nenhum nó `general`.
  - `não deixa nenhum nó sem ligação`: base com projeto, task, nota, meta com e sem projeto, hábito, arquivo com e sem projeto → todo nó tem `connectionCount >= 1`.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/utils/graph-layout.test.ts`. Esperado: FALHA (sem Geral; meta vai ao primeiro projeto; hábito solto).
  - `liga projeto sem itens ao Geral`: projeto sozinho → aresta projeto→Geral.
  - `usa ids estáveis por entidade`: o nó da task `t1` tem id `task:t1`; o Geral tem id `general:general`; montar o grafo duas vezes, a segunda com um hábito a mais, mantém os ids de todos os nós anteriores.
- [ ] Passo 3: em `buildGraph`, `addNode` usa `${type}:${entityId}` como id. Função local `linkToGeneral(nodeId)` cria o nó Geral sob demanda (lazy, para ele só existir quando usado) e empurra aresta `structural`. Usar em arquivos sem projeto válido, metas sem projeto válido (remove o ramo `firstProjectId`), todos os hábitos e, ao final, em todo projeto que ficou sem nenhuma aresta. `baseRadii.general = 20`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(grafo): nó Geral para itens sem projeto`.

### Task 3: Memórias no buildGraph

**Arquivos:** Modificar `src/renderer/src/utils/graph-layout.ts`. Teste `src/renderer/src/__tests__/utils/graph-layout.test.ts`.
**Interfaces:** Consome `linkToGeneral` (Task 2). Produz `buildGraph(projects, tasks, notes, goals, habits, files = [], memories: AiMemory[] = [])`; `GraphNodeType` com `'memory'`; `GraphEdge.type: 'explicit' | 'structural' | 'tag'`; `GRAPH_NODE_COLORS.memory = '#5a9ea0'`; `MEMORY_TAG_LINK_LIMIT = 3`; nó memória `{ type: 'memory', label: m.title, entityId: m.id, projectId: m.projectId ?? undefined, base radius 7 }`.

- [ ] Passo 1: testes que falham:
  - `liga memória de projeto ao projeto e memória global ao Geral`.
  - `liga memória de projeto removido ao Geral`.
  - `ignora memórias arquivadas` (`archivedAt` preenchido → sem nó).
  - `liga memórias com tag em comum, ignorando caixa e espaços` (`'Electron'` e `' electron '` → 1 aresta `tag`).
  - `não liga handoffs por tag` (handoff com mesma tag → nenhuma aresta `tag` com ele; continua ligado ao projeto).
  - `limita a 3 ligações por tag por memória`: 6 memórias com tag `x` → toda memória tem ≤ 3 arestas `tag`; nenhum par repetido; nenhum laço.
  - `prefere as memórias com mais tags em comum`: A{x,y}, B{x,y}, C{x}, D{x}, E{x} → A–B existe.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/utils/graph-layout.test.ts`. Esperado: FALHA (`buildGraph` ignora o 7º argumento).
- [ ] Passo 3: após os hábitos, criar nós de memória (filtrar `archivedAt == null`), aresta `structural` ao projeto ou `linkToGeneral`. Ligações por tag: gerar todos os pares de memórias não-handoff com ≥ 1 tag normalizada em comum; ordenar por (nº de tags em comum desc, maior `updatedAt` do par desc, `idA+idB` asc); aceitar um par só se as duas memórias têm < 3 arestas `tag` (guloso: garante o limite dos dois lados). Em `createLiveSimulation`: distância `TAG_LINK_DISTANCE = 90`, força `TAG_LINK_STRENGTH = 0.4`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(grafo): memórias ligadas a projetos e por tags`.

### Task 4: GraphView carrega e desenha memórias

**Arquivos:** Modificar `src/renderer/src/components/views/GraphView.tsx`, `src/renderer/src/utils/graph-layout.ts` (só o tipo `NavigateTarget`). Teste `src/renderer/src/__tests__/components/GraphView.test.tsx`.
**Interfaces:** Consome `buildGraph(..., memories)`, `GRAPH_NODE_COLORS.memory/general`. Produz `NavigateTarget` com `{ type: 'memory'; id: string }`.

- [ ] Passo 0: preparar o arquivo de teste: um `beforeEach` define `window.electronAPI = { ai: { memory: { list: vi.fn().mockResolvedValue([]) } } }` (vale também para os 2 testes existentes, que senão quebram) e o `afterEach` remove; o mock de `buildGraph` vira `vi.fn(() => ({ nodes: graph.nodes, edges: graph.edges }))` declarado em `vi.hoisted`; o mock de `GRAPH_NODE_COLORS` ganha `memory: '#5a9ea0'` e `general: '#8a8a94'`.
- [ ] Passo 1: testes que falham:
  - `passa as memórias ativas ao buildGraph`: `list` resolve `[mem]` → após `await`, última chamada de `buildGraph` recebe `[mem]` como 7º argumento; `list` foi chamado com `{ includeArchived: false }`.
  - `mostra aviso quando as memórias não carregam`: `list` rejeita → texto `Não foi possível carregar as memórias.` visível e o nó de projeto continua desenhado.
  - `envia o ID ao navegar para uma memória`: nó mockado `type: 'memory'`, duplo clique → `onNavigate({ type: 'memory', id })`; duplo clique no nó `general` → `onNavigate` não chamado.
  - `desenha arestas por tag na cor própria`: aresta mockada `type: 'tag'` → `line[stroke="#4a7a7c"]` sem `marker-end`.
  - `lista Geral na barra lateral acima dos projetos`: primeiro botão da barra lateral tem texto `Geral`.
  - legenda contém `Memória` e `Geral`.
- [ ] Passo 2: `npx vitest run src/renderer/src/__tests__/components/GraphView.test.tsx`. Esperado: FALHA.
- [ ] Passo 3: em `GraphView`, `useState<AiMemory[]>([])` + `useState(false)` para erro; `useEffect` de montagem chama `window.electronAPI.ai.memory.list({ includeArchived: false })` com flag de cancelamento no cleanup; `.catch` liga o erro. Incluir `memories` no `useMemo` do `buildGraph`. Aresta `tag`: `stroke="#4a7a7c"`, `strokeWidth=1`, sem dash e sem seta. `handleNodeDoubleClick`: `case 'memory'` → `onNavigate({ type: 'memory', id: node.entityId })`; `general` sem ação. `showLabel`: `general` sempre visível. Tooltip: `memory` → `Memória`, `general` → `Geral` (trocar o ternário encadeado por um mapa `TYPE_LABEL: Record<GraphNodeType, string>`). Barra lateral: nó `general` primeiro, depois projetos; "Nenhum projeto" só aparece quando não há projeto **nem** Geral. Legenda: itens `Memória` e `Geral`. Rodapé: aviso de erro à esquerda do contador, `text-[#d9a640]`. Estado vazio: novo texto; a condição `nodes.length === 0` já cobre "sem itens e sem memórias".
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(grafo): carrega memórias e mostra o nó Geral`.

### Task 5: Navegação do grafo para a memória

**Arquivos:** Criar `src/renderer/src/utils/focused-entity-hit.ts` (move `focusedEntityHit` de `App.tsx` para lá, exportado). Modificar `src/renderer/src/App.tsx`. Teste `src/renderer/src/__tests__/utils/focused-entity-hit.test.ts`. Nenhum teste renderiza `App` hoje (depende de `security:status`, `loadData` etc.), então a fiação no `switch` é verificada no app na Task 6 (decisão do construtor).
**Interfaces:** Consome `NavigateTarget` `memory` (Task 4).

- [ ] Passo 1: teste `cria o alvo de busca de uma memória`: `focusedEntityHit('memory', 'mem-1', '', false)` → `{ type: 'memory', id: 'mem-1', projectId: null }` (via `toMatchObject`); e um caso `goal` igual ao comportamento atual.
- [ ] Passo 2: `npx vitest run <arquivo>`. Esperado: FALHA (módulo não existe).
- [ ] Passo 3: `focusedEntityHit(type: 'goal' | 'habit' | 'memory', …)` em `utils/focused-entity-hit.ts` (`GlobalSearchHit.type` já inclui `'memory'`); `App.tsx` importa de lá; no `switch` do `onNavigate` do grafo, `case 'memory'`: `setSearchTarget(focusedEntityHit('memory', target.id, '', false))`, `setSearchSerial(+1)`, `setActiveView('memory')`.
- [ ] Passo 4: mesmo comando. Esperado: PASSA.
- [ ] Passo 5: commit `feat(grafo): duplo clique abre a memória`.

### Task 6: Verificação final, docs e PR

- [ ] `npm run typecheck`, `npm run lint`, `npm test` (via `sagyou-test-runner`). Esperado: tudo passa.
- [ ] `npm run dev`: abrir o grafo; duplo clique numa memória abre a tela Memória com ela destacada; com memórias globais e de projeto; conferir Geral, arestas por tag, nenhum nó solto, duplo clique em memória, cores sóbrias.
- [ ] Docs: `GUIDE.md` (parágrafo do grafo, ~linha 472): memórias, nó Geral, limite de 3 por tag, leitura via `ai:memory:list`. `CLAUDE.md`: linha do grafo na tabela de views (hoje ausente) e a mesma regra. `README.md` linha 43: "…metas, hábitos e memórias".
- [ ] commit `docs(grafo): memórias e nó Geral`; seguir para `sagyou-review` e `sagyou-pr`.
