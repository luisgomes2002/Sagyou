/** @vitest-environment node */
import { describe, it, expect } from 'vitest'
import { repairBackup } from '../modules/files/backup-repair'
import { isValidBackup } from '../modules/files/backup-validation'

// Shapes taken from a real backup the app exported and then refused to import.
const backup = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 7,
  exportedAt: '2026-10-26T15:48:40.288Z',
  projects: [{ id: 'p1', name: 'Murasaki Languages', columns: [] }],
  tasks: [],
  ...extra
})

describe('repairBackup', () => {
  it('drops sprints and notes of a deleted project, so the backup validates', () => {
    const data = backup({
      sprints: [
        { id: 's1', projectId: 'gone', name: 'v1.0', createdAt: '2026-06-11T20:15:48.807Z' },
        { id: 's2', projectId: 'p1', name: 'v2', createdAt: '2026-06-11T20:15:48.807Z' }
      ],
      notes: [{ id: 'n1', projectId: 'gone', createdAt: '2026-06-12T11:07:40.155Z' }],
      tombstones: [{ id: 'gone', type: 'project', deletedAt: '2026-06-11T20:16:36.418Z' }]
    })
    expect(isValidBackup(data)).toBe(false)
    const repaired = repairBackup(data) as Record<string, { id: string }[]>
    expect(isValidBackup(repaired)).toBe(true)
    expect(repaired.sprints.map((s) => s.id)).toEqual(['s2'])
    expect(repaired.notes).toEqual([])
  })

  it('points a sprint whose projectId is the project name back at the project id', () => {
    const data = backup({
      sprints: [
        {
          id: 's1',
          projectId: 'Murasaki Languages',
          name: 'Sprint 1',
          createdAt: '2026-08-11T19:57:36.560Z'
        }
      ]
    })
    const repaired = repairBackup(data) as Record<string, { projectId: string }[]>
    expect(isValidBackup(repaired)).toBe(true)
    expect(repaired.sprints[0].projectId).toBe('p1')
  })

  it('unlinks a goal from a deleted project instead of dropping the goal', () => {
    const repaired = repairBackup(
      backup({ goals: [{ id: 'g1', title: 'Meta', projectId: 'gone' }] })
    ) as Record<string, Record<string, unknown>[]>
    expect(isValidBackup(repaired)).toBe(true)
    expect(repaired.goals[0]).toEqual({ id: 'g1', title: 'Meta' })
  })

  it('adjusts planner times whose end is not after the start', () => {
    const block = (startTime: string, endTime: string): Record<string, unknown> => ({
      id: `${startTime}-${endTime}`,
      date: '2026-08-10',
      startTime,
      endTime
    })
    const repaired = repairBackup(
      backup({
        timeBlocks: [
          block('23:20', '00:00'),
          block('13:10', '13:10'),
          block('23:59', '23:59'),
          block('09:00', '10:00')
        ],
        routines: [{ id: 'r1', startTime: '22:00', endTime: '00:00', daysOfWeek: [1] }]
      })
    ) as Record<string, { startTime: string; endTime: string }[]>
    expect(isValidBackup(repaired)).toBe(true)
    expect(repaired.timeBlocks.map((b) => `${b.startTime}-${b.endTime}`)).toEqual([
      '23:20-23:59',
      '13:10-13:11',
      '23:58-23:59',
      '09:00-10:00'
    ])
    expect(repaired.routines[0].endTime).toBe('23:59')
  })

  it('leaves what it cannot safely repair for the validator to refuse', () => {
    const data = backup({
      tasks: [{ id: 't1', title: 'x', projectId: 'gone', columnId: 'c1' }],
      timeBlocks: [{ id: 'b1', date: '2026-08-10', startTime: '25:00', endTime: '26:00' }]
    })
    expect(isValidBackup(repairBackup(data))).toBe(false)
    expect(repairBackup(null)).toBeNull()
    expect(repairBackup({ projects: 'x' })).toEqual({ projects: 'x' })
  })
})
