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
- `index.ts` — creates the BrowserWindow, registers IPC handlers for `window:*`, `store:*`, `backup:*`, `ai:*`
- `store.ts` — reads/writes `kanban-data.json` in `app.getPath('userData')` using plain `fs`

**Preload** (`src/preload/index.ts`)
- Bridges IPC to the renderer via `contextBridge`, exposing `window.electronAPI` (typed in `index.d.ts`)

**Renderer** (`src/renderer/src/`)
- Single-page React app. Entry point is `main.tsx` → `App.tsx`
- All state lives in one Zustand store: `store/kanban.ts`
- `App.tsx` owns all modal state and UI event handlers, passing them as props down to views and modals

### State layer

`store/kanban.ts` exports `useKanbanStore` (Zustand). Every mutation calls `_persist()` internally, which serializes the full state and calls `storage.save()`.

Storage is injected via `IStorageAdapter` (`services/StorageAdapter.ts`). In production, `ElectronStorage` is used (calls `window.electronAPI`). In tests, `ElectronStorage` is vi-mocked in `__tests__/setup.ts`.

Soft deletes use a `Tombstone[]` array. On `importBackup`, a three-way merge (`mergeEntities`) reconciles local vs. remote data using tombstones to avoid resurrection of deleted records.

### Views

`App.tsx` renders one view at a time based on `activeView` state:

| View | Component | Notes |
|---|---|---|
| `board` | `Board.tsx` | dnd-kit drag-and-drop across columns |
| `canvas` | `CanvasView.tsx` | free-form sticky notes with task links |
| `done` | `DoneView.tsx` | tasks in any column named "done" |
| `goals` | `GoalView.tsx` | progress goals with optional project link |
| `habits` | `HabitView.tsx` | daily habit tracker with streak |
| `shopping` | `ShoppingView.tsx` | multi-currency shopping lists |
| `upcoming` | `UpcomingView.tsx` | tasks with due dates |
| `reports` | `ReportsView.tsx` | productivity overview |

### IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `store:load` / `store:save` | renderer→main | persist full app state |
| `backup:export` / `backup:import` | renderer→main | open save/open dialog |
| `ai:import` | renderer→main | import AI-generated JSON tasks |
| `window:minimize/maximize/close/is-maximized` | renderer→main | custom title bar controls |
| `window:maximized-change` | main→renderer | notify maximize/restore |

### Types

All domain types are in `src/renderer/src/types/index.ts`. Notable constants exported alongside types: `PROJECT_COLORS` (`as const` tuple — use `useState<string>` when storing a selected color), `NOTE_COLORS`, `CURRENCY_CONFIG`, `DEFAULT_COLUMN_NAMES`, `DEFAULT_TAGS` (categorized tag list used in tag pickers and the AI import prompt template; categories: Dev, Estudo, Trabalho, Saúde, Casa & Vida, Finanças, Pessoal).

## Data / Schema safety

The app persists state as JSON in `kanban-data.json` on the user's machine. There is **production data in the wild** — users have real tasks, habits, goals, and financial records stored in this format.

- **Never remove or rename fields** on existing types without a migration or backward-compatible fallback (e.g. optional field with a default on load).
- **Never change the shape of persisted arrays or objects** in a breaking way (reordering, nesting, type changes).
- Adding new optional fields is safe — the store hydrates with `??` defaults and missing keys are silently ignored.
- **Always warn explicitly** before making any change that could corrupt or lose existing data on load (e.g. changing a field from `string` to `string[]`, removing a required field, changing an ID scheme). Flag it with: _"⚠️ Breaking schema change — existing data may be affected."_

## Testing

Tests run in jsdom via Vitest. `ElectronStorage` is always vi-mocked — tests call `useKanbanStore.getState()` directly to exercise store actions. Test files live in `src/renderer/src/__tests__/` under `store/`, `integration/`, `services/`, and `utils/`.

The `coverage/` directory is generated output — do not commit it.
