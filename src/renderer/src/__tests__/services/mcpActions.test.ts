import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({})
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.autoSaveBackup = vi.fn().mockResolvedValue({ success: true })
      this.commitBackupBlobs = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadMemories = vi.fn().mockResolvedValue([])
      this.replaceMemories = vi.fn().mockResolvedValue(undefined)
      this.rebuildSearchIndex = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import { applyMcpAction, prepareMcpAction } from '../../services/mcpActions'
import { DEFAULT_FINANCIAL_PROFILE_ID, PROJECT_COLORS, type Project, type Task } from '../../types'
import type { McpActionResult, McpScope } from '../../types/mcp-actions'

const state = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()

function resetStore(): void {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    financialProfiles: [
      {
        id: DEFAULT_FINANCIAL_PROFILE_ID,
        name: 'Minhas finanças',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z'
      }
    ],
    activeFinancialProfileId: DEFAULT_FINANCIAL_PROFILE_ID,
    activeProjectId: null,
    sprintFilter: null,
    activeTimers: [],
    isLoaded: true
  })
}

/** Runs both phases the way main does: prepare must pass before apply. */
function both(name: string, args: Record<string, unknown>, scope: McpScope): McpActionResult {
  const prepared = prepareMcpAction(name, args, scope)
  if (!prepared.ok) return prepared
  return applyMcpAction(name, args, scope)
}

function seedProject(name = 'Sagyou'): { id: string; scope: McpScope } {
  const id = state().createProject(name)
  return { id, scope: { projectId: id, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID } }
}

const general: McpScope = { projectId: null, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID }
const project = (id: string): Project => state().projects.find((item) => item.id === id)!

describe('MCP project and column writes', () => {
  beforeEach(resetStore)

  it('prepare never writes', () => {
    const { scope } = seedProject()
    const result = prepareMcpAction('create_column', { name: 'Testes' }, scope)
    expect(result).toMatchObject({ ok: true, resumo: 'Criar coluna "Testes" em Sagyou' })
    expect(state().projects[0].columns.map((c) => c.name)).not.toContain('Testes')
  })

  it('create_project trims, creates default columns and keeps the active project', () => {
    const { id: active } = seedProject('Atual')
    const result = both('create_project', { name: '  Novo  ', color: PROJECT_COLORS[1] }, general)
    expect(result.ok).toBe(true)
    const created = state().projects.find((p) => p.name === 'Novo')!
    expect(created.color).toBe(PROJECT_COLORS[1])
    expect(created.columns).toHaveLength(4)
    expect(state().activeProjectId).toBe(active)
  })

  it('create_project with a duplicate name returns the existing id without writing', () => {
    const { id } = seedProject('Sagyou')
    const result = both('create_project', { name: 'sagyou ' }, general)
    expect(result).toMatchObject({ ok: true, id, existente: true })
    expect(state().projects).toHaveLength(1)
  })

  it('update_project edits fields and refuses an unknown color', () => {
    const { id, scope } = seedProject()
    expect(both('update_project', { description: 'Kanban' }, scope).ok).toBe(true)
    expect(project(id).description).toBe('Kanban')
    expect(both('update_project', { color: '#123456' }, scope)).toMatchObject({ ok: false })
    expect(both('update_project', {}, scope)).toEqual({ ok: false, error: 'Nada para alterar.' })
  })

  it('links replace keeps ids of unchanged urls and refuses credentials', () => {
    const { id, scope } = seedProject()
    state().updateProject(id, {
      links: [{ id: 'keep', label: 'Repo', url: 'https://github.com/x/y' }]
    })
    expect(
      both(
        'update_project',
        {
          links: [
            { label: 'Repo', url: 'https://github.com/x/y' },
            { url: 'https://docs.example.com/a' }
          ]
        },
        scope
      ).ok
    ).toBe(true)
    const links = project(id).links!
    expect(links[0].id).toBe('keep')
    expect(links[1]).toMatchObject({ label: 'docs.example.com', url: 'https://docs.example.com/a' })
    expect(
      both('update_project', { links: [{ url: 'https://user:senha@example.com/' }] }, scope)
    ).toEqual({ ok: false, error: 'Links não podem conter usuário ou senha.' })
    expect(both('update_project', { links: [] }, scope).ok).toBe(true)
    expect(project(id).links).toEqual([])
  })

  it('archive and unarchive are idempotent', () => {
    const { id, scope } = seedProject()
    expect(both('archive_project', {}, scope)).toMatchObject({ ok: true })
    expect(project(id).archivedAt).toBeDefined()
    expect(both('archive_project', {}, scope)).toMatchObject({ ok: true, jaArquivado: true })
    expect(both('unarchive_project', {}, scope)).toMatchObject({ ok: true })
    expect(project(id).archivedAt).toBeUndefined()
  })

  it('delete_project keeps notes and goals, and the resumo counts tasks', () => {
    const { id, scope } = seedProject()
    const col = project(id).columns[0].id
    state().createTask({ projectId: id, columnId: col, title: 'A' })
    state().createTask({ projectId: id, columnId: col, title: 'B' })
    state().createNote(id, { content: 'nota' })
    state().createGoal({
      title: 'Meta',
      target: 3,
      unit: '',
      color: PROJECT_COLORS[0],
      kind: 'quantity',
      projectId: id
    })
    expect(prepareMcpAction('delete_project', {}, scope)).toMatchObject({
      resumo: 'Excluir projeto "Sagyou" e 2 tarefa(s)'
    })
    expect(applyMcpAction('delete_project', {}, scope).ok).toBe(true)
    expect(state().projects).toHaveLength(0)
    expect(state().tasks).toHaveLength(0)
    expect(state().notes).toHaveLength(1)
    expect(state().goals).toHaveLength(1)
  })

  it('delete_project of a project removed after prepare refuses in apply', () => {
    const { id, scope } = seedProject()
    expect(prepareMcpAction('delete_project', {}, scope).ok).toBe(true)
    state().deleteProject(id)
    expect(applyMcpAction('delete_project', {}, scope)).toEqual({
      ok: false,
      error: 'Projeto não encontrado.'
    })
  })

  it('general scope without projectId asks for one', () => {
    expect(both('create_column', { name: 'X' }, general)).toEqual({
      ok: false,
      error: 'Escolha um projeto em list_projects.'
    })
  })

  it('create, rename and reorder columns', () => {
    const { id, scope } = seedProject()
    const created = both('create_column', { name: 'Testes' }, scope)
    expect(created.ok).toBe(true)
    expect(project(id).columns.at(-1)!.name).toBe('Testes')
    expect(both('update_column', { column: 'testes', name: 'QA' }, scope).ok).toBe(true)
    expect(project(id).columns.at(-1)!.name).toBe('QA')
    const reversed = project(id)
      .columns.map((c) => c.id)
      .reverse()
    expect(both('reorder_columns', { columnIds: reversed }, scope).ok).toBe(true)
    expect([...project(id).columns].sort((a, b) => a.order - b.order).map((c) => c.id)).toEqual(
      reversed
    )
    expect(both('reorder_columns', { columnIds: reversed.slice(1) }, scope)).toEqual({
      ok: false,
      error: 'columnIds precisa listar todas as colunas do projeto, uma vez cada.'
    })
  })

  it('renaming Done or naming a column done is refused', () => {
    const { scope } = seedProject()
    const refusal = {
      ok: false,
      error: 'A coluna de concluídas é identificada pelo nome "Done"; renomeie-a no Sagyou.'
    }
    expect(both('update_column', { column: 'Done', name: 'Feito' }, scope)).toEqual(refusal)
    expect(both('update_column', { column: 'Review', name: 'DONE' }, scope)).toEqual(refusal)
    expect(both('create_column', { name: 'done' }, scope)).toEqual(refusal)
  })

  it('delete_column refuses a column with tasks and the last column', () => {
    const { id, scope } = seedProject()
    const backlog = project(id).columns[0]
    state().createTask({ projectId: id, columnId: backlog.id, title: 'A' })
    expect(both('delete_column', { column: 'Backlog' }, scope)).toEqual({
      ok: false,
      error: 'A coluna "Backlog" tem 1 tarefa(s); mova-as antes de excluí-la.'
    })
    expect(both('delete_column', { column: 'Review' }, scope).ok).toBe(true)
    expect(project(id).columns.map((c) => c.name)).not.toContain('Review')
  })

  it('delete_column refuses in apply when a task appeared after prepare, deleting nothing', () => {
    const { id, scope } = seedProject()
    const review = project(id).columns.find((c) => c.name === 'Review')!
    expect(prepareMcpAction('delete_column', { column: 'Review' }, scope).ok).toBe(true)
    state().createTask({ projectId: id, columnId: review.id, title: 'Nova' })
    expect(applyMcpAction('delete_column', { column: 'Review' }, scope)).toMatchObject({
      ok: false
    })
    expect(state().tasks).toHaveLength(1)
    expect(project(id).columns.map((c) => c.name)).toContain('Review')
  })
})

describe('MCP task writes', () => {
  beforeEach(resetStore)

  function seedTasks(): {
    id: string
    scope: McpScope
    taskId: string
    col: (name: string) => string
  } {
    const { id, scope } = seedProject()
    const col = (name: string): string => project(id).columns.find((c) => c.name === name)!.id
    const taskId = state().createTask({
      projectId: id,
      columnId: col('Backlog'),
      title: 'Corrigir login',
      description: 'antiga',
      dueDate: '2026-11-01',
      tags: ['bug']
    })
    return { id, scope, taskId, col }
  }
  const task = (id: string): Task | undefined => state().tasks.find((t) => t.id === id)

  it('update_task only touches sent keys and clears with empty string', () => {
    const { scope, taskId } = seedTasks()
    expect(both('update_task', { id: taskId, priority: 'high', description: '' }, scope).ok).toBe(
      true
    )
    expect(task(taskId)).toMatchObject({
      priority: 'high',
      dueDate: '2026-11-01',
      tags: ['bug'],
      title: 'Corrigir login'
    })
    expect(task(taskId)!.description).toBeUndefined()
    expect(both('update_task', { id: taskId, tags: [], newTitle: 'Login' }, scope).ok).toBe(true)
    expect(task(taskId)).toMatchObject({ tags: [], title: 'Login' })
  })

  it('update_task rejects an impossible date and an unknown priority', () => {
    const { scope, taskId } = seedTasks()
    expect(both('update_task', { id: taskId, dueDate: '2026-02-30' }, scope)).toMatchObject({
      ok: false
    })
    expect(both('update_task', { id: taskId, priority: 'alta' }, scope)).toMatchObject({
      ok: false
    })
    expect(task(taskId)!.dueDate).toBe('2026-11-01')
  })

  it('finds a task by title and refuses an ambiguous title with candidatos', () => {
    const { id, scope, col } = seedTasks()
    expect(both('update_task', { title: 'corrigir LOGIN', priority: 'low' }, scope).ok).toBe(true)
    state().createTask({ projectId: id, columnId: col('Review'), title: 'Corrigir login' })
    const result = both('update_task', { title: 'Corrigir login', priority: 'urgent' }, scope)
    expect(result).toMatchObject({
      ok: false,
      error: 'Mais de um registro com esse título; use o id.'
    })
    expect((result as { candidatos: unknown[] }).candidatos).toHaveLength(2)
    expect(state().tasks.every((t) => t.priority !== 'urgent')).toBe(true)
  })

  it('move_task within the project reports completion and reopening', () => {
    const { scope, taskId, col } = seedTasks()
    expect(both('move_task', { id: taskId, column: 'Done' }, scope)).toMatchObject({
      ok: true,
      concluida: true
    })
    expect(task(taskId)!.columnId).toBe(col('Done'))
    expect(both('move_task', { id: taskId, column: 'Review' }, scope)).toMatchObject({
      ok: true,
      reaberta: true
    })
  })

  it('move_task across projects without column lands in the target first column', () => {
    const { scope, taskId } = seedTasks()
    const { id: other } = seedProject('Outro')
    expect(both('move_task', { id: taskId, projectId: other }, scope).ok).toBe(true)
    expect(task(taskId)).toMatchObject({
      projectId: other,
      columnId: project(other).columns[0].id
    })
  })

  it('move_task across projects resolves the column on the target, clears sprint and credits timer', () => {
    const { id, scope, taskId } = seedTasks()
    const sprintId = state().createSprint(id, 'S1')
    state().setTaskSprint(taskId, sprintId)
    useKanbanStore.setState({ activeTimers: [{ taskId, startedAt: Date.now() - 60_000 }] })
    const { id: other } = seedProject('Outro')
    const targetReview = project(other).columns.find((c) => c.name === 'Review')!.id
    expect(both('move_task', { id: taskId, projectId: other, column: 'Review' }, scope).ok).toBe(
      true
    )
    expect(task(taskId)).toMatchObject({ projectId: other, columnId: targetReview })
    expect(task(taskId)!.sprintId).toBeUndefined()
    expect(task(taskId)!.timeSpent).toBeGreaterThanOrEqual(60)
    expect(state().activeTimers).toHaveLength(0)
  })

  it('move_task to a column created earlier in the same run works', () => {
    const { scope, taskId } = seedTasks()
    expect(both('create_column', { name: 'Testes' }, scope).ok).toBe(true)
    expect(both('move_task', { id: taskId, column: 'Testes' }, scope).ok).toBe(true)
  })

  it('complete_task and reopen_task are idempotent', () => {
    const { scope, taskId, col } = seedTasks()
    expect(both('complete_task', { id: taskId }, scope)).toMatchObject({ ok: true })
    expect(task(taskId)).toMatchObject({ columnId: col('Done') })
    expect(task(taskId)!.completedAt).toBeDefined()
    expect(both('complete_task', { id: taskId }, scope)).toMatchObject({
      ok: true,
      jaConcluida: true
    })
    expect(both('reopen_task', { id: taskId }, scope)).toMatchObject({ ok: true })
    expect(task(taskId)).toMatchObject({ columnId: col('Backlog') })
    expect(both('reopen_task', { id: taskId }, scope)).toMatchObject({ ok: true, jaAberta: true })
  })

  it('complete_task refuses a project without a Done column', () => {
    const { id, scope, taskId } = seedTasks()
    const doneCol = project(id).columns.find((c) => c.name === 'Done')!
    state().deleteColumn(id, doneCol.id)
    expect(both('complete_task', { id: taskId }, scope)).toEqual({
      ok: false,
      error: 'O projeto não tem coluna de concluídas.'
    })
  })

  it('delete_task leaves a tombstone and its resumo names the project', () => {
    const { scope, taskId } = seedTasks()
    expect(prepareMcpAction('delete_task', { id: taskId }, scope)).toMatchObject({
      resumo: 'Excluir tarefa "Corrigir login" do projeto Sagyou'
    })
    expect(applyMcpAction('delete_task', { id: taskId }, scope).ok).toBe(true)
    expect(task(taskId)).toBeUndefined()
    expect(state().tombstones.some((t) => t.id === taskId && t.type === 'task')).toBe(true)
  })

  it('a task deleted after prepare returns "Tarefa não encontrada." in apply', () => {
    const { scope, taskId } = seedTasks()
    expect(prepareMcpAction('update_task', { id: taskId, priority: 'low' }, scope).ok).toBe(true)
    state().deleteTask(taskId)
    expect(applyMcpAction('update_task', { id: taskId, priority: 'low' }, scope)).toEqual({
      ok: false,
      error: 'Tarefa não encontrada.'
    })
  })
})
