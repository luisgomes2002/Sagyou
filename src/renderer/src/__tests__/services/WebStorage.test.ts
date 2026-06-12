import { describe, it, expect, beforeEach } from 'vitest'
import { WebStorage } from '../../services/WebStorage'
import type { Backup } from '../../types'

const STORAGE_KEY = 'kanban-data'

describe('WebStorage', () => {
  let storage: WebStorage

  beforeEach(() => {
    localStorage.clear()
    storage = new WebStorage()
  })

  describe('load', () => {
    it('returns empty arrays when nothing is stored', async () => {
      const data = await storage.load()
      expect(data.projects).toEqual([])
      expect(data.tasks).toEqual([])
      expect(data.sprints).toEqual([])
      expect(data.tombstones).toEqual([])
      expect(data.notes).toEqual([])
      expect(data.goals).toEqual([])
      expect(data.habits).toEqual([])
      expect(data.lists).toEqual([])
    })

    it('returns empty arrays when stored JSON is corrupt', async () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{')
      const data = await storage.load()
      expect(data.projects).toEqual([])
    })

    it('loads previously saved data', async () => {
      const payload = { projects: [{ id: 'p1', name: 'Test' }], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      const data = await storage.load()
      expect(data.projects).toHaveLength(1)
      expect(data.projects[0].id).toBe('p1')
    })

    it('fills missing keys with empty arrays', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: [] }))
      const data = await storage.load()
      expect(data.tasks).toEqual([])
      expect(data.sprints).toEqual([])
    })
  })

  describe('save', () => {
    it('persists data that can be reloaded', async () => {
      const payload = {
        projects: [{ id: 'p1', name: 'My Project', color: '#fff', columns: [], createdAt: '', updatedAt: '' }],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      }
      await storage.save(payload)
      const loaded = await storage.load()
      expect(loaded.projects[0].id).toBe('p1')
    })

    it('overwrites previous data on each save', async () => {
      await storage.save({ projects: [{ id: 'old', name: 'Old', color: '', columns: [], createdAt: '', updatedAt: '' }], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] })
      await storage.save({ projects: [{ id: 'new', name: 'New', color: '', columns: [], createdAt: '', updatedAt: '' }], tasks: [], sprints: [], tombstones: [], notes: [], goals: [], habits: [], lists: [] })
      const data = await storage.load()
      expect(data.projects).toHaveLength(1)
      expect(data.projects[0].id).toBe('new')
    })
  })

  describe('exportBackup', () => {
    it('returns success:true', async () => {
      const backup: Backup = { version: 2, exportedAt: new Date().toISOString(), projects: [], tasks: [] }
      const result = await storage.exportBackup(backup)
      expect(result.success).toBe(true)
    })
  })
})
