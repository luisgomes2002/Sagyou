# Plano: N agentes trabalhando no mesmo projeto

> Objetivo: permitir que **vários agentes de IA trabalhem no mesmo projeto ao mesmo
> tempo** dentro do app — começando por 2 e generalizando para N —, com **múltiplos
> cronômetros simultâneos** e um **painel** onde dá pra ver todos os agentes, abrir o
> chat de cada um e saber o que cada um está fazendo e em qual projeto.

---

## 1. Correção importante sobre o risco de dados

O renderer é **single-thread**. Toda tool de escrita passa por uma action do store
(`createTask`, `updateTask`, …) que faz `set(s => …)` sobre o **estado mais fresco**,
e o `_persist()` é **debounced (300ms) + full-replace** (`store/kanban.ts:200-208`),
serializando o estado inteiro atual. O `saveData` no main também é single-thread e
atômico por transação (`main/store.ts:854-869`).

**Consequência:** dois loops de agente rodando concorrentemente no renderer **não
corrompem o SQLite** — cada escrita é aplicada sobre o estado atual e o save colapsa
tudo no snapshot final. Não há "lost update" no caminho do renderer.

O problema real de N agentes no mesmo projeto **não é corrupção de dados** — é:

1. **Coordenação** — dois agentes fazendo trabalho duplicado/conflitante.
2. **Singletons de estado de run** (`busy`, `runningConvId`, `approvalResolver`, …).
3. **Timer único** (`activeTimer`) — que agora **queremos** tornar múltiplo.
4. **Corridas reais de filesystem** — só no agente de código nativo (edita disco + git).

---

## 2. Decisões desta revisão

- **Múltiplos cronômetros ao mesmo tempo.** O timer deixa de ser instância única; cada
  task pode ter seu cronômetro rodando em paralelo (humano + agentes, ou vários agentes).
  Isso é uma **mudança de schema** (Fase 5) — carrega migração e compatibilidade de
  backup.
- **Painel de Agentes (FleetView).** Uma view nova que lista todos os agentes ativos,
  mostra o que cada um está fazendo e em qual projeto, permite abrir o chat de cada um e
  pará-los (Fase 6).

---

## 3. Fase 0 — Modelo de concorrência (decisão de base)

Dois tipos de agente, com riscos diferentes:

- **Agentes de chat** (`runAgent`, renderer): seguros para paralelizar — single-thread,
  escritas via action sobre estado fresco. O trabalho é *desingletonizar* o estado de
  run e *coordenar* semântica.
- **Agentes de código nativo** (`code-agent.ts`, main, escrevem no disco): **não** são
  seguros no mesmo cwd — dois processos editando os mesmos arquivos + `git` = corrida
  real de FS, sem proteção. Resposta: isolar (git worktree) ou serializar.

**Decisão:** liberar N chat-agents no mesmo projeto; manter code-agents **serializados
por diretório** (ou 1 por worktree).

---

## 4. Fase 1 — Desingletonizar o estado de run (`store/aiRun.ts`)

Hoje tudo assume um run. Vira coleção indexada por `convId`:

| Singular hoje | Vira | Linha (aiRun.ts) |
|---|---|---|
| `busy: boolean` | `running: Set<convId>` (+ `isRunning(id)`) | 194 |
| `runningConvId: string \| null` | removido — a chave *é* o convId do loop | 224 |
| `streaming: string` | `streaming: Record<convId, string>` | 196 |
| `streamingTools: string[]` | `Record<convId, string[]>` | 205 |
| `error: string \| null` | `Record<convId, string>` | 206 |
| `approvalResolver` (módulo, 1 slot) | `Map<convId, resolver>` | 182 |
| `pendingApproval` (1 card) | `pendingApprovals: PendingApproval[]` (fila) | 236 |
| `abortRequested: boolean` | `abortRequested: Set<convId>` | 246 |
| `autoApprove: boolean` | `autoApprove: Set<convId>` | 244 |
| *(novo)* | `runProjects: Record<convId, projectId>` — qual projeto cada run trabalha | — |

**`runProjects`** é novo e habilita o painel (Fase 6): `send()` já lê
`activeProjectId` (`aiRun.ts:327`) mas não guarda; passa a registrar `runProjects[convId]`
no início e limpar no `finally`. Idealmente o `projectId` também é persistido no registro
da conversa (main) para sobreviver a reload.

**Já pronto e reaproveitável:** `parked: Record<convId>`, `routeRun`/`routeUsage` — o
roteamento por conversa já existe (`aiRun.ts:104-129`). A mudança maior é `send()` não
mais fazer `if (busy) return` global (`aiRun.ts:305`) e sim
`if (running.has(convId)) return` — impede reentrada da *mesma* conversa, permite outras.

**Marco testável:** só com a Fase 1 pronta, já dá pra rodar 2 agentes em paralelo em
**modo automático** (`autoApprove` dispensa o card) — prova a desingletonização antes de
investir na UI.

---

## 5. Fase 2 — Code-agents: serializar por diretório (`main/index.ts`)

Único ponto de corrupção real (FS + git). Independente da Fase 1 (arquivo diferente).

- **(a) Serializar por projeto (recomendado, barato):** trocar
  `codeAgentRunning: boolean` (`main/index.ts:195`) por `Set<projectDir>` — permite N
  code-agents em projetos *diferentes*, mas **1 por diretório**. Elimina a corrida.
- **(b) Worktrees (paralelo real no mesmo repo):** cada code-agent roda num
  `git worktree` próprio; ao terminar, merge/aplicar diff de volta. Muito mais trabalho
  (criar/limpar worktree, resolver conflitos, ai-jail apontando pro worktree). Só vale
  se paralelismo de código no mesmo repo for requisito duro. **Adiar.**

---

## 6. Fase 3 — Fila de aprovação (`components/AiRunHost.tsx`)

N runs podem parar em aprovação ao mesmo tempo. Hoje há **um** card. Depende da Fase 1.

- Renderizar uma **pilha/fila** de cards (um por run parado), rotulados com a
  conversa/projeto de origem.
- O binding de Escape (hoje assume um card só) resolve **o card do topo** apenas.
- Modo automático por-conversa dispensa o card como hoje.

---

## 7. Fase 4 — Coordenação: evitar trabalho duplicado (leasing)

Sem isso, dois agentes pegam a mesma task ou criam duplicadas. Camada de *leasing* leve,
**em memória de runtime, sem schema novo**. Depende da Fase 1.

- Um `Map<taskId, convId>` no `aiRun` marcando "task X está sendo trabalhada pelo run Y".
- Tools de trabalho (`mover_task`, `concluir_task`, `atualizar_task`) consultam o lease;
  se a task já está arrendada por outro run ativo, retornam um resultado sintético
  *"task já está sendo trabalhada por outro agente — escolha outra"* (mesmo padrão dos
  "freios"/brakes já existentes em `runAgent`).
- Lease liberado no `finally` do `send()`.
- Para `criar_tasks`, dedup por título dentro do projeto; reforçar no prompt no cenário
  multi-agente.

Coordenação *cooperativa* (o modelo recebe o aviso e desvia), consistente com os
brakes/prune que o app já tem — sem lock pessimista.

---

## 8. Fase 5 — Múltiplos cronômetros simultâneos (`activeTimer` → coleção)

> ⚠️ **Breaking schema change — existing data may be affected.**
> `activeTimer` é persistido no `settings` (JSON) e viaja no backup; virar coleção exige
> migração e fallback de compatibilidade.

Hoje `activeTimer: ActiveTimer | null` no store (`kanban.ts:196`), persistido em
`settings` (`main/store.ts:848`), enviado no save (`kanban.ts:202`) e restaurado no
`loadData` com commit do tempo decorrido (`kanban.ts:217`).

**Mudança:**
- `activeTimer: ActiveTimer | null` → `activeTimers: ActiveTimer[]` (no máximo 1 por
  task; chave lógica = `taskId`).
- `startTimer(taskId)` adiciona; `stopTimer(taskId)` / `concluir_task` remove e credita
  o tempo em `task.timeSpent`.
- **Migração no load:** se o legado `settings.activeTimer` (objeto único) existir e não
  houver `activeTimers`, embrulhar em `[activeTimer]`. Fazer o commit de tempo decorrido
  em **loop** sobre todos (hoje é um só, `kanban.ts:217`).
- **Compatibilidade de backup / versões antigas:** continuar escrevendo o campo legado
  `activeTimer = activeTimers[0]` (mesmo padrão do `activeCodePathId` que espelha
  `activeCodePathIds[0]`), para um app/backup antigo ainda resolver um timer.
- **Consumidores a atualizar:** qualquer UI que lê `activeTimer` (timer na task,
  ReportsView, etc.) passa a olhar a coleção; a tool `iniciar_cronometro` deixa de
  competir por um slot único.

**Nota:** isso substitui a antiga variante "3(a) simples" (não mexer no timer global) —
agora múltiplos timers é requisito, então adotamos a variante completa com schema.

---

## 9. Fase 6 — Painel de Agentes (FleetView)

Nova view no switch do `App.tsx` (`activeView === 'agents'` → `FleetView.tsx`), no mesmo
padrão das views existentes. Depende da Fase 1 (`running: Set` + `runProjects`).

**O que mostra, por agente ativo (derivado de `running: Set<convId>`):**
- **Qual projeto** — de `runProjects[convId]` → nome em `projects`.
- **O que está fazendo agora** — última status line com `done===false`, ou
  `streamingTools[convId]`, ou o texto em `streaming[convId]`.
- **Progresso** — passo `N/max` e tokens acumulados do run.
- **Cronômetros ativos** desse agente (da Fase 5), se houver.
- **Estado de aprovação** — se está parado esperando um card.

**Ações por agente:**
- **Abrir chat** → `openConversation(conv)` + `setActiveView('ai')` — leva à conversa
  daquele agente com todo o histórico.
- **Parar** → `abort(convId)`.
- **Aprovar** — atalho para o card daquele run (integra com a fila da Fase 3).

**Atualização ao vivo:** a view lê o store `aiRun`, que já atualiza a cada passo do loop;
nenhum polling necessário.

**Entrada na navegação:** item "Agentes" na Sidebar, com um badge da contagem de runs
ativos (`running.size`).

---

## 10. Testes

- `aiRun` já é testável isolado. Novos testes: dois `send()` concorrentes escrevem em
  conversas distintas sem vazar (estende os testes de `routeRun`/`parked`); `runProjects`
  registra e limpa por run.
- **Leasing:** um agente arrendou a task → tool do outro recebe o aviso.
- **`store.ts`:** escritas concorrentes intercaladas convergem (nenhuma perdida) — pin do
  comportamento single-thread.
- **Timers múltiplos:** migração do legado `activeTimer` → `activeTimers`; commit de
  tempo em loco no load; espelho `activeTimer = activeTimers[0]`; dois timers rodando
  creditam tempo em tasks distintas.
- **Code-agent:** `Set<projectDir>` recusa segundo run no mesmo dir, aceita em outro.
- **FleetView:** deriva a lista de agentes de `running`/`runProjects`; "Abrir chat"
  troca a view e a conversa.

---

## 11. Faseamento por valor/risco (onde cortar)

- **Núcleo funcional:** Fases 1 + 3 + 4 → destrava e organiza N chat-agents no mesmo
  projeto.
- **Segurança de FS:** Fase 2 → code-agents seguros por diretório (barato).
- **Timers múltiplos:** Fase 5 → a única com risco de schema; requer migração cuidadosa.
- **Visibilidade:** Fase 6 → o painel; maior valor visível pra você.
- **Adiar:** Fase 2(b) worktrees — só com necessidade comprovada.

**MVP para "2 agentes no mesmo projeto":** Fases 1 + 2(a) + 3 + 4. Sem schema, sem risco
de corrupção. Timers (5) e painel (6) entram em seguida.

---

## 12. Ordem de implementação

Guiada por **dependências** e por ter um incremento testável a cada passo.

**Ordem:** `1 → 2(a) → 3 → 4 → 5 → 6`
(`1` e `2(a)` podem andar em paralelo — tocam arquivos diferentes)

Caminho crítico de verdade: **1 → 3 → 4**. As demais encaixam em volta.

1. **Fase 1 — desingletonizar `aiRun` (+ `runProjects`)** — *fundação, bloqueia tudo.*
   Pré-requisito das Fases 3, 4 e 6. Faça primeiro, sozinho. Marco testável: 2 agentes em
   paralelo no modo automático.

2. **Fase 2(a) — code-agent `Set<projectDir>`** — *independente, faça cedo.*
   Não depende da Fase 1 (arquivo diferente). Pequena, baixo risco, fecha o único ponto
   de corrupção real (FS). Pode andar em paralelo com a Fase 1.

3. **Fase 3 — fila de aprovação** — *destrava o modo manual.* Depende da Fase 1.

4. **Fase 4 — leasing** — *torna útil em vez de caótico.* Depende da Fase 1. É o passo
   que faz "2 no mesmo projeto" valer a pena.

5. **Fase 5 — múltiplos timers (schema)** — *depois do núcleo estável.* Requer migração;
   isole essa mudança num passo próprio, bem testado, para não misturar risco de schema
   com o resto.

6. **Fase 6 — Painel de Agentes** — *maior valor visível, por último no funcional.*
   Depende da Fase 1 (`running` + `runProjects`) e integra a Fase 3 (aprovar) e a Fase 5
   (timers). Uma versão mínima (lista + "abrir chat" + "parar") já pode subir logo após a
   Fase 1; os detalhes (timers, fila de aprovação) entram conforme 3 e 5 ficam prontas.
