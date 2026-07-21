# Roadmap — Sistema de Memória do Assistente (Sagyou)

> Memória persistente própria, inspirada no `ai-memory` do akitaonrails, mas **nativa
> ao harness** (o loop do chat em `ai/agent.ts` e o code-agent em `code-agent.ts`).
> Sem Docker, sem MCP, sem hooks HTTP — você é dono do loop, então memória é
> leitura no início e escrita no fim, não infraestrutura.

## Princípios

1. **Dono do loop → sem infra.** Ler/escrever memória são chamadas de função dentro do loop, não um servidor externo.
2. **Tabela satélite no `kanban.db` (SQLite), com caminho próprio.** Decay bumpa `lastAccessedAt`/`accessCount` a cada leitura; num JSON isso é write-amplification (reescreve o arquivo todo, o problema já documentado do `ai-conversations.json`). SQLite resolve com `UPDATE … WHERE id=?` barato, dá FK `ON DELETE CASCADE` pra `projects` e FTS5 se precisar. 🔴 **Nunca via `persistAll`/store Zustand** — `persistAll` faz replace total, então um bump de contador reescreveria o banco inteiro. É satélite (como `project_code_paths`) com escrita própria por `ai:memory:*`.
3. **Security-first.** A sanitização de segredos entra **junto** do caminho de escrita (Fase 1), nunca depois.
4. **Token budget.** Memória entra filtrada por relevância/recência, nunca reenviada inteira. Decay + consolidação mantêm o corpus pequeno.
5. **Um store, dois loops.** Chat e code-agent compartilham a memória, keyed por `projectId`.

## Modelo de dado

```ts
// src/renderer/src/types/index.ts
interface AiMemory {
  id: string
  projectId: string | null      // null = global (fatos sobre o usuário / estilo)
  type: 'decisao' | 'tradeoff' | 'gotcha' | 'fato' | 'handoff'
  title: string
  body: string
  tags: string[]
  pinned: boolean               // nunca sofre decay
  source: 'modelo' | 'usuario'
  createdAt: string
  updatedAt: string
  lastAccessedAt: string        // bumpado a cada injeção/leitura → alimenta o decay
  accessCount: number           // idem
}

// Constantes (types/index.ts): MEMORY_TYPES, MEMORY_DECAY_BASE_DAYS (ex. 45),
// MEMORY_MAX (ex. 500), MEMORY_INJECT_MAX (quantas entram por run)
```

Persistência: tabela no `kanban.db`, gravada por SQL direto (fora do `persistAll`).

```sql
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  project_id TEXT,                    -- NULL = global
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',    -- JSON array
  pinned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,                   -- NULL = ativa; preenchido = arquivada por decay
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id) WHERE archived_at IS NULL;
```

- **touch** = `UPDATE memory SET last_accessed_at=?, access_count=access_count+1 WHERE id IN (…)` — um statement barato, sem reescrever nada.
- **arquivar** = setar `archived_at` (não deleta a linha).
- IPC: `ai:memory:list/save/delete/touch/summary`, cada um SQL direto no `store.ts`, **fora do `persistAll`**.

---

## Fases (ordenadas por dependência + valor)

| Fase | Entrega | Esforço | Desbloqueia |
|---|---|---|---|
| **0** | Fundação: tipo + store puro + IPC + persistência | M | tudo |
| **1** | Escrita segura: tool `salvar_memoria` + **sanitização** | M | o modelo grava fatos |
| **2** | Leitura/briefing: injeção no prompt + recall | M | "lembrar das conversas" + "tradeoffs" |
| **3** | Higiene: decay (apagar frias) + lint (contradições) | M | corpus confiável e pequeno |
| **4** | Handoff automático entre sessões | P | continuidade sem o modelo lembrar de gravar |
| **5** | Conforto: bootstrap + backup + View no app | G | partida quente, portabilidade, visibilidade |

MVP utilizável = Fases 0→2. Fases 3→4 = qualidade. Fase 5 = polimento.

---

### Fase 0 — Fundação (sem UI, sem injeção) ✅ CONCLUÍDA

O esqueleto. Nada visível ainda, mas testável de ponta a ponta.

> **Feito:** `src/main/memory.ts` (puro, 17 testes verdes em `memory.test.ts`) com
> `buildMemory` (já scrubba segredos), `scrubSecrets`, decay (`decayTtlDays`/`isStale`/`selectStale`),
> `summarizeMemories`, `findConflicts`. Tabela `memory` no `initSchema` + CRUD SQL no `store.ts`
> (`listMemories`, `memoriesForContext`, `getMemory`, `upsertMemory`, `touchMemories`,
> `archiveMemories`, `deleteMemory`) — **fora do `persistAll`**. Handlers
> `ai:memory:list/save/delete/touch/prune/summary/conflicts` no `index.ts`. Bridge no preload
> + tipos no `index.d.ts`. typecheck limpo. Falta só ligar aos loops (Fases 1–2).

- **`src/renderer/src/types/index.ts`** — tipo `AiMemory` + constantes.
- **`src/main/memory.ts`** (novo, **puro, sem import de electron** — como `usage.ts`/`run-metrics.ts`): `normalizeMemory()`, `sanitizeMemory()`, `pruneMemories()` (recebe rows, devolve o que arquivar), `findContradictions()`. Só lógica; **nada de SQL aqui**.
- **`src/main/store.ts`** — `CREATE TABLE IF NOT EXISTS memory` no bootstrap do schema + CRUD SQL fino (`insertMemory`, `updateMemory`, `touchMemories`, `listMemories`, `archiveMemories`, `deleteMemory`). **Fora do `persistAll`.**
- **`src/main/index.ts`** — handlers `ai:memory:list/save/delete/touch/summary` chamando o CRUD do `store.ts` (save passa por `sanitizeMemory` antes).
- **`src/preload/index.ts`** + **`index.d.ts`** — bridge `window.electronAPI`.
- **`services/StorageAdapter.ts`** (`IStorageAdapter`) + `ElectronStorage`/`WebStorage` — métodos de memória que chamam `ai:memory:*` (molde de `loadConversations`), **não** o store Zustand.
- **Testes:** `src/main/__tests__/memory.test.ts` (`@vitest-environment node`) — normalize, prune/decay, sanitize, contradições, tudo sobre as funções puras (sem tocar SQLite).

> ⚠️ Documentar `ai-memory.json` na tabela **Data / Schema safety** do `CLAUDE.md` + resumir no `GUIDE.md`.

### Fase 1 — Escrita segura (tool + sanitização) 🔴 ✅ CONCLUÍDA

Aqui o modelo passa a gravar. **A sanitização é bloqueante e ship junto — nunca depois.**

> **Feito:** tool `salvar_memoria` no `REGISTRY` (`write:true` → gated), args em PT
> (`tipo`/`titulo`/`corpo`/`tags`/`global`/`fixar`), mapeando pro store via
> `window.electronAPI.ai.memory.save`; escopo projeto-ativo por padrão, `global:true`
> para fatos do usuário. Sanitização já vem da Fase 0 (`buildMemory`→`scrubSecrets`),
> e o resultado devolve `aviso` quando algo foi redigido. Labels em `describeToolActivity`
> + `describeToolCall`. Regra "Memória entre conversas" no `system-prompt.md`. 6 testes
> novos em `tools.test.ts` (264 verdes no dir de AI); typecheck limpo.

- **`ai/tools.ts`** — entrada no `REGISTRY`: `salvar_memoria` (`write: true` → gated na aprovação como todo write tool). Args: `type`, `title`, `body`, `tags?`, `projectId?`, `pinned?`.
- **`src/main/memory.ts`** — `sanitizeMemory()` no caminho de `save`:
  - scrub por regex: `sk-…`, `AKIA…`, `ghp_…`, `-----BEGIN … KEY-----`, linhas estilo `.env` (`FOO_SECRET=…`).
  - `ignore_paths`: recusar memória cuja origem seja `.env`, `.aws`, `.ssh`, `node_modules`, etc.
  - Irmão dos guardas `isImageFileName`/`decodeDataUrl` que já existem.
- **`ai/system-prompt.md`** — regra: "quando você ou o usuário fixar uma decisão/tradeoff/gotcha durável, grave com `salvar_memoria`; nunca grave segredos".
- **`describeToolActivity`** em `agent.ts` — label para `salvar_memoria` (o teste que exige label pra toda tool vai cobrar).
- **Testes:** tool grava; segredo é redigido; caminho de `.env` é recusado.

### Fase 2 — Leitura / briefing (injeção + recall) ✅ CONCLUÍDA

O payoff. "Lembrar das conversas" e "tradeoffs" vão ao ar.

> **Feito:** `formatMemoriesForPrompt` (puro, em `memory.ts`) — forma completa até
> `MEMORY_INJECT_MAX`, só títulos acima, **decay-neutral** (o briefing não faz touch).
> Handler `ai:memory:briefing` (projeto + globais) + bridge. `runAgent` injeta o
> briefing no início do system prompt (guardado; bridge ausente = sem briefing),
> escopo passado pelo `send` do `aiRun.ts` (`activeProjectId`). Code-agent também é
> briefado (`buildSystemPrompt({memories})`, `projectId` threaded via
> `rodar_agente_codigo`→run handler, best-effort). Tools `buscar_memoria` (filtra +
> **faz touch** — única fonte de acesso) e `buscar_conversas` (reusa
> `ai:conversations:search`). Regra atualizada no `system-prompt.md`. Testes:
> formatador (memory.test), 2 read tools (tools.test), injeção + falha guardada
> (agent.test). typecheck limpo; handlers 52✓ (só a falha pré-existente do sandbox).

- **`ai/agent.ts` (`runAgent`)** — no início do run: carregar memórias do `projectId` ativo + globais, montar bloco compacto (índice se passar de `MEMORY_INJECT_MAX`; inteiro enquanto pequeno) e injetar no system prompt. Logo depois, `ai:memory:touch` em lote nas injetadas (alimenta decay).
- **`code-agent.ts` (`buildSystemPrompt`)** — mesma injeção, ao lado de `GUIDE.md`/árvore/arquivos pinados.
- **`ai/tools.ts`** — `buscar_memoria` (leitura sob demanda do corpo cheio; faz `touch`) + `buscar_conversas` (reusa `conversation-search.ts` que já existe em main — só expor como tool).
- **Testes:** injeção respeita escopo (projeto + global); `touch` bumpa acesso; `buscar_conversas` acha por corpo sem acento.

### Fase 3 — Higiene (decay + lint) ✅ CONCLUÍDA

"Apagar memórias frias" + manter o corpus confiável.

> **Feito:** `runMemoryPrune()` (helper em `index.ts`) dispara no início de cada run,
> **dentro do handler `ai:memory:briefing`** (guardado) — arquiva frias + overflow via
> `selectStale`, devolve `archived`; `runAgent` emite um status "N arquivada(s)" só
> quando > 0 (raro = sinal, não ruído). `ai:memory:prune` reusa o mesmo helper. Tool
> `verificar_memorias` (read) casa `findConflicts` (via `ai:memory:conflicts`) com o
> corpo das duas memórias de cada par, devolve com `aviso`. Regra no `system-prompt.md`.
> Testes: tool (tools.test), status de decay ligado/desligado (agent.test). 296✓ em
> memory+AI, 52✓ handlers (só o sandbox pré-existente); typecheck/lint limpos.
> **Nota de design:** dead-file-ref (memória citando arquivo inexistente) foi adiado —
> exige extrair caminhos do corpo + checar nas roots; contradição é o sinal de rot que importa.

- **`src/main/memory.ts` — `pruneMemories()`** (chamado lazy no início do run, molde `pruneRuns`/`pruneSupersededResults`):
  - decay **exponencial**: `ttlDays = MEMORY_DECAY_BASE_DAYS * (1 + ln(accessCount))` → memória muito usada ≈ permanente, tocada 1x some rápido.
  - **`pinned` nunca sai.**
  - **arquiva, não deleta** (move pra um `_arquivo` no mesmo JSON) e **reporta** ("N memórias arquivadas por inatividade"). Hard-delete = opção explícita. *(decisão a travar — ver abaixo)*.
  - dedup barato: funde memórias de título muito similar **sem LLM**.
- **`verificar_memorias` (lint)** — sinaliza pares contraditórios e memórias que citam arquivos inexistentes; devolve como `aviso` (mesmo padrão de `concluidas_ocultas`/`aviso` que o código já usa pra "admitir o que escondeu"). Nunca bloqueia.
- **Testes:** memória fria não-pinada arquiva; pinada sobrevive; contradição é sinalizada.

### Fase 4 — Handoff automático ✅ CONCLUÍDA

Continuidade sem depender do modelo lembrar de gravar.

> **Feito:** `writeHandoff` (em `aiRun.ts`, exportado/testado) roda após cada resposta —
> deriva um breadcrumb do último par pergunta+resposta (truncado), **sem chamada LLM**.
> Handler `ai:memory:handoff` faz upsert de **uma memória `handoff` por projeto** (id
> determinístico `handoffId(projectId)`), mantendo `lastAccessedAt=now` sem inflar
> `access_count` — decai ~45d após o projeto ficar quieto. Injetado no próximo run pela
> Fase 2. `findConflicts` **ignora handoffs** (mesmo título por design). Tudo guardado:
> pula abort/vazio, bridge ausente = no-op. Testes: `writeHandoff` (aiRun.test — escopo,
> título, truncamento, skips, no-op), `handoffId` + skip-handoff (memory.test). 302✓.
> **Decisão:** breadcrump do último exchange, não um resumo curado (resumo por LLM
> custaria uma chamada, contra o orçamento de token). O usuário/modelo pode fixar um
> handoff importante ou gravar um fato real com salvar_memoria.

- **`ai/agent.ts` — `finally` do `runAgent`** (ao lado do `ai:run-metrics:append` que já existe): gravar um `type: 'handoff'` com "o que fiz / o que ficou em aberto / próximo passo", derivado da resposta final + trace de tools. Best-effort, fire-and-forget, guardado (bridge ausente = no-op).
- Injetado no próximo run pela Fase 2 (filtrar o handoff mais recente do projeto).
- **Testes:** run que fez algo grava handoff; handoff aparece no briefing seguinte.

### Fase 5 — Conforto (backup + View ✅; bootstrap adiado)

> **Feito:**
> - **Backup** (v4): `exportBackup` carrega as memórias (via `storage.loadMemories`, todas
>   incl. arquivadas), `importBackup` as restaura (`replaceMemories`) — mesmo tratamento
>   store-externo das conversas, guardado. `ai:memory:replace` (main) faz replace FK-safe
>   (projeto ausente → global). Métodos no `IStorageAdapter` + ambos os adaptadores.
>   4 testes novos no `kanban.test`.
> - **View** `memory`: `MemoryView.tsx` (aba no Sidebar + branch no `App.tsx`) — lista
>   ativas/arquivadas, fixar/desafixar, restaurar, apagar (com confirmação), contagem.
>   Lê via `ai:memory:*` direto (fora do store Zustand, como o `AIView` lê o histórico).
> - **Bootstrap ADIADO** (com razão): importar `CLAUDE.md` como memórias exige resumo por
>   LLM pra virar fatos discretos (uma chamada, contra o orçamento); split ingênuo vira
>   ruído; e o code-agent já lê `GUIDE.md` direto. Baixo valor/alto custo — fica no backlog.
>
> Suite: **1138✓ / 1 falha** (só o sandbox pré-existente, env-dependente). typecheck:web limpo.

Detalhe original abaixo (referência):

- **Bootstrap** — comando/botão "importar `CLAUDE.md`/`GUIDE.md`/git log como memórias iniciais" (partida quente; o `CLAUDE.md` já é um banco de memória escrito à mão).
- **Backup** — `backup:export`/`import` carregam `ai-memory.json` junto (como já fazem com `ai-conversations.json`).
- **View `memory`** em `App.tsx` — aba nova no switch (ao lado de `reports`/`ai`) pra ver/editar/fixar/apagar; `ai:memory:summary` no header (molde `ai:usage:summary`). Vantagem de casa sobre a web UI separada do Akita.

---

## Mapa de arquivos (visão única)

| Arquivo | Fase | O quê |
|---|---|---|
| `types/index.ts` | 0 | tipo `AiMemory` + constantes |
| `src/main/memory.ts` (novo) | 0/1/3 | lógica **pura**: normalize, sanitize, prune/decay, lint (sem SQL) |
| `src/main/store.ts` | 0 | tabela `memory` + CRUD SQL, **fora do `persistAll`** |
| `src/main/index.ts` | 0 | handlers `ai:memory:*` |
| `src/preload/index.ts` + `index.d.ts` | 0 | bridge |
| `services/StorageAdapter.ts` + adapters | 0 | métodos de memória via `ai:memory:*` (fora do store) |
| `ai/tools.ts` | 1/2 | `salvar_memoria`, `buscar_memoria`, `buscar_conversas` |
| `ai/system-prompt.md` | 1 | regra de quando gravar |
| `ai/agent.ts` | 2/4 | injeção + touch + handoff no `finally` |
| `code-agent.ts` | 2 | injeção no `buildSystemPrompt` |
| `App.tsx` + nova view | 5 | aba `memory` |
| backup export/import | 5 | carregar memória junto |
| `src/main/__tests__/memory.test.ts` | 0+ | testes da lógica pura |

## Decisões travadas

1. ✅ **Decay = arquivar** (`archived_at`), não hard-delete. Linha permanece; reversível; aba "arquivadas" possível na View.
2. ✅ **Store = tabela satélite no `kanban.db`**, fora do `persistAll` (ver Princípio 2). Markdown-no-repo fica como export opcional de v2.
3. ✅ **Memória compartilhada** chat↔code-agent — uma coluna `project_id`, sem discriminador de escopo.

## Notas de teste

- Lógica pura em `src/main/memory.ts` → `@vitest-environment node`.
- Tools em `src/renderer/src/__tests__/ai/` com o provider stubbado.
- `vitest.config.ts` já fixa `TZ=America/Sao_Paulo` — bugs de data local no decay não se escondem.
