import { describe, expect, it } from 'vitest'
import { upcomingTasks } from '../dueDates'
import type { Project, Task } from '../types'

const T = '2026-10-01T00:00:00.000Z'
const project = (id: string, archivedAt?: string): Project =>
  ({
    id,
    name: id,
    color: '#000',
    order: 0,
    createdAt: T,
    updatedAt: T,
    archivedAt,
    columns: [
      { id: `${id}-todo`, name: 'A fazer', order: 0 },
      { id: `${id}-done`, name: 'Done', order: 1 }
    ]
  }) as unknown as Project
const task = (id: string, dueDate: string | undefined, extra: Partial<Task> = {}): Task => ({
  id,
  projectId: 'p1',
  columnId: 'p1-todo',
  title: id,
  priority: 'medium',
  tags: [],
  order: 0,
  createdAt: T,
  updatedAt: T,
  dueDate,
  ...extra
})

describe('upcomingTasks', () => {
  it('lista todas as tarefas com prazo, vencidas primeiro, sem corte de 7 dias', () => {
    const tasks = [
      task('daqui-30-dias', '2026-11-30'),
      task('amanha', '2026-11-01'),
      task('vencida', '2026-10-20'),
      task('sem-prazo', undefined)
    ]
    expect(upcomingTasks(tasks, [project('p1')]).map((t) => t.id)).toEqual([
      'vencida',
      'amanha',
      'daqui-30-dias'
    ])
  })

  it('exclui concluídas, as da coluna Done e as de projeto arquivado', () => {
    const tasks = [
      task('concluida', '2026-11-01', { completedAt: T }),
      task('na-done', '2026-11-01', { columnId: 'p1-done' }),
      task('arquivado', '2026-11-01', { projectId: 'p2', columnId: 'p2-todo' })
    ]
    expect(upcomingTasks(tasks, [project('p1'), project('p2', T)])).toEqual([])
  })
})
