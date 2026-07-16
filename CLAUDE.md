# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (Electron + Vite HMR)
npm run typecheck    # typecheck both main and renderer processes
npm run lint         # ESLint
npm test             # run all tests once
npm run test:watch   # run tests in watch mode
npm run test:coverage # generate coverage report in coverage/

# Run a single test file
npx vitest run src/renderer/src/__tests__/store/kanban.test.ts

# Build distributables
npm run build:win
npm run build:mac
npm run build:linux
```

## Architecture

The app is a frameless Electron window split into three processes:

**Main** (`src/main/`)
- `index.ts` — creates the BrowserWindow, registers IPC handlers for `window:*`, `store:*`, `backup:*`, `files:*`, `excel:*`, `ai:*`. Also proxies all AI provider calls (keeps the API key out of the renderer and sidesteps CORS), spawns the external code agent, and serves read-only source access to the assistant.
- `store.ts` — persists state to a **SQLite database** (`better-sqlite3`) at `app.getPath('userData')/kanban.db` (`kanban-dev.db` in dev). Opened in WAL mode with foreign keys on. Each save is a full replace inside a transaction (`persistAll` deletes children→parents, then re-inserts). One-time `migrateFromJson()` runs on first boot: if the legacy `kanban-data.json` exists and the DB is empty, it imports it and renames the file to `.migrated`. The `kanban-data.json` format now only survives as the backup/export shape (produced in the renderer), **not** as the storage format.

**Preload** (`src/preload/index.ts`)
- Bridges IPC to the renderer via `contextBridge`, exposing `window.electronAPI` (typed in `index.d.ts`)

**Renderer** (`src/renderer/src/`)
- Single-page React app. Entry point is `main.tsx` → `App.tsx`
- All state lives in one Zustand store: `store/kanban.ts`
- `App.tsx` owns all modal state and UI event handlers, passing them as props down to views and modals

### State layer

`store/kanban.ts` exports `useKanbanStore` (Zustand). Every mutation calls `_persist()` internally, which serializes the full state and calls `storage.save()` — the payload is sent over IPC and written to SQLite by the main process (see Main above).

Storage is injected via `IStorageAdapter` (`services/StorageAdapter.ts`). In production, `ElectronStorage` is used (calls `window.electronAPI`). `WebStorage` is a parallel `localStorage`-backed implementation kept for an eventual browser build — it is not wired up in the app, but it must keep satisfying `IStorageAdapter`, so a change to that interface means changing both adapters. In tests, `ElectronStorage` is vi-mocked in `__tests__/setup.ts`.

AI chat history is **not** part of the main store — it lives in its own file and is reached through `loadConversations()` / `saveConversations()` on the adapter, which backup export/import calls separately.

`loadData` and `importBackup` normalize every incoming `FinancialTable` through `normalizeList` — this fills missing arrays, defaults the currency, and **migrates monetary fields from legacy `number` to canonical decimal string** (see Data / Schema safety). Do the same for any new load path.

Soft deletes use a `Tombstone[]` array. On `importBackup`, all local state is replaced wholesale by the backup file — no merge. The helper functions `mergeEntities`, `mergeSprints`, `mergeHabits`, and `mergeTombstones` remain in `store/kanban.ts` but are unused.

### Views

`App.tsx` renders one view at a time based on `activeView` state:

| View | Component | Notes |
|---|---|---|
| `board` | `Board.tsx` | dnd-kit drag-and-drop across columns |
| `canvas` | `CanvasView.tsx` | free-form sticky notes with task links |
| `files` | `FilesView.tsx` | file attachments, optionally scoped to a project |
| `done` | `DoneView.tsx` | tasks in any column named "done" |
| `goals` | `GoalView.tsx` | progress goals with optional project link |
| `habits` | `HabitView.tsx` | daily habit tracker with streak |
| `financial` | `FinancialView.tsx` | shell over the tabs in `components/financial/` — shopping lists, transactions, financial goals, analytics |
| `upcoming` | `UpcomingView.tsx` | tasks with due dates |
| `reports` | `ReportsView.tsx` | productivity overview |
| `ai` | `AIView.tsx` | chat with the assistant (see AI assistant below) |

`board`, `canvas`, and `files` share the project-scoped layout, so they are selected by a nested branch in `App.tsx` rather than the top-level one.

### IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `store:load` / `store:save` | renderer→main | persist full app state |
| `backup:export` / `backup:import` | renderer→main | open save/open dialog |
| `files:upload/delete/open/openInBrowser/download` | renderer→main | manage attachments in `userData/files` |
| `excel:export` | renderer→main | write a workbook built in the renderer to disk |
| `ai:import` | renderer→main | import AI-generated JSON tasks |
| `ai:config:get` / `ai:config:set` | renderer→main | read/write provider config |
| `ai:models` | renderer→main | list models offered by the configured provider |
| `ai:chat` / `ai:chat:stream` | renderer→main | proxy a chat completion to the provider |
| `ai:chat:delta` | main→renderer | text chunks for an in-flight `ai:chat:stream`, tagged with the caller's `streamId` |
| `ai:code-agent:run/stop/status` | renderer→main | drive the external code agent |
| `ai:code-agent:output` / `ai:code-agent:exit` | main→renderer | agent stdout/stderr and exit code |
| `ai:pick-directory` | renderer→main | directory picker for a project's code path |
| `ai:code:list/read/search` | renderer→main | read-only source access for the assistant |
| `ai:conversations:list/get/save/delete/all/replace` | renderer→main | chat history in `ai-conversations.json` |
| `window:minimize/maximize/close/is-maximized` | renderer→main | custom title bar controls |
| `window:maximized-change` | main→renderer | notify maximize/restore |

### AI assistant

`ai/` holds a tool-calling assistant that talks to any OpenAI-compatible provider (base URL + key + model, configured in the UI and stored in `ai-config.json`).

- `ai/tools.ts` — a single `REGISTRY` object is the source of truth: each entry pairs an OpenAI-format `definition` (sent to the model) with a `run` handler executed against the Zustand store. `TOOL_DEFS` and the dispatcher are derived from it, so **adding a tool means adding one entry** and nothing else. Tools are in Portuguese (`ler_tasks`, `criar_tasks`, `ler_financeiro`, …).
- Tools marked `write: true` mutate state (`criar_tasks`, `concluir_task`, `iniciar_cronometro`, `criar_sprints`, `atribuir_sprint`, `rodar_agente_codigo`). `isWriteTool()` gates them behind user approval — `AIView` asks before running them unless the user turns on automatic mode. **Keep `write: true` on any new mutating tool**; it is the only thing standing between the model and the user's data.
- `ai/agent.ts` — the loop. `runAgent` iterates model→tools→model, capped at `MAX_STEPS` (default 6) so a misbehaving model can't spin forever. Every call goes through the main process rather than the renderer.
- The assistant can read a project's source when the project has a code path set: `listar_arquivos`, `ler_arquivo`, `buscar_no_codigo` map to the `ai:code:*` handlers, which confine every path to the selected root. `rodar_agente_codigo` is separate and heavier — it spawns an external CLI agent (`aider` or `codex`, expected on PATH) to actually modify code, streaming output back over `ai:code-agent:output`.

### Types

All domain types are in `src/renderer/src/types/index.ts`. Notable constants exported alongside types: `PROJECT_COLORS` (`as const` tuple — use `useState<string>` when storing a selected color), `NOTE_COLORS`, `CURRENCY_CONFIG`, `DEFAULT_COLUMN_NAMES`, `DEFAULT_TAGS` (categorized tag list used in tag pickers and the AI import prompt template; categories: Dev, Estudo, Trabalho, Saúde, Casa & Vida, Finanças, Pessoal), `PRIORITY_CONFIG`, `AI_TASK_PROMPT_TEMPLATE` (the JSON schema prompt the sidebar's "Copiar tudo" produces).

## Data / Schema safety

The app persists state to a **SQLite database** (`kanban.db`) in `app.getPath('userData')`. There is **production data in the wild** — users have real tasks, habits, goals, and financial records stored on their machines.

Not everything lives in the DB. Also in `userData`:

| Path | Contents |
|---|---|
| `kanban.db` | the main store (projects, tasks, sprints, notes, goals, habits, financial tables, file metadata, `settings`) |
| `files/` | the actual uploaded file blobs — the `files` table only holds metadata, so deleting a row without the blob (or vice versa) orphans the other |
| `ai-config.json` | AI provider base URL, API key, model |
| `ai-conversations.json` | AI chat history |

Treat these with the same care as the DB — the same "production data in the wild" caveat applies.

- **Never remove or rename fields** on existing types without a migration or backward-compatible fallback (e.g. optional field with a default on load).
- **Never change the shape of persisted arrays or objects** in a breaking way (reordering, nesting, type changes).
- Adding new optional fields is safe — the store hydrates with `??` defaults and missing keys are silently ignored.
- **Always warn explicitly** before making any change that could corrupt or lose existing data on load (e.g. changing a field from `string` to `string[]`, removing a required field, changing an ID scheme). Flag it with: _"⚠️ Breaking schema change — existing data may be affected."_

### Monetary fields are decimal strings

`FinancialTransaction.amount`, `FinancialGoal.targetAmount`, and `ShoppingItem.price` are stored **in memory and in backups/JSON as canonical decimal strings** (e.g. `"1500.5"`), not numbers. All money arithmetic goes through `decimal.js` — use the `D()` helper and `Decimal` methods (`.plus/.minus/.times/.div`) in `components/financial/shared.ts`; only convert to `number` for display geometry (bar widths, percentages). `qty` stays a `number` (it's a quantity, not currency).

- On load, `normalizeList` migrates any legacy `number` values to canonical string via `moneyStr` — old data and old backups keep working.
- The SQLite columns for these fields are `TEXT` (`price`, `amount`, `target_amount`), storing decimal strings on disk. `qty` stays `REAL`. On insert, `moneyText()` in `main/store.ts` coerces number-or-string to a string.
- `migrateMoneyColumnsToText()` in `main/store.ts` upgrades existing databases: it detects the legacy `REAL` columns via `PRAGMA table_info` and rebuilds those three tables as `TEXT` (create `_new`, `CAST` copy, drop, rename — inside a transaction with foreign keys toggled off). Idempotent: skips tables already `TEXT`.

## Testing

Tests run in jsdom via Vitest. `ElectronStorage` is always vi-mocked — tests call `useKanbanStore.getState()` directly to exercise store actions. Test files live in `src/renderer/src/__tests__/` under `store/`, `integration/`, `services/`, `utils/`, and `ai/` (the agent loop and the tool registry, with the provider stubbed).

The `coverage/` directory is generated output — do not commit it.
