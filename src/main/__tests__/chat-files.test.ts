/**
 * Tests for chat-files.ts — the file storage and validation rules.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { isChatFileName, saveAndParseChatFile, deleteChatFiles } from '../../main/chat-files'
import type { ChatDocumentMeta } from '../../main/chat-files'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'chat-files-test-'))
}

let counter = 0
function makeId(): string {
  counter++
  return `00000000-0000-4000-a000-${String(counter).padStart(12, '0')}.txt`
}

describe('isChatFileName', () => {
  it('accepts a uuid filename with extension', () => {
    expect(isChatFileName('a1b2c3d4-5678-90ab-cdef-1234567890ab.txt')).toBe(true)
    expect(isChatFileName('00000000-0000-4000-a000-000000000001.pdf')).toBe(true)
    expect(isChatFileName('ffffffff-ffff-ffff-ffff-ffffffffffff.csv')).toBe(true)
  })

  it('rejects traversal attempts', () => {
    expect(isChatFileName('../../etc/passwd')).toBe(false)
    expect(isChatFileName('a1b2c3d4-5678-90ab-cdef-1234567890ab.txt/../')).toBe(false)
    expect(isChatFileName('../a1b2c3d4-5678-90ab-cdef-1234567890ab.txt')).toBe(false)
  })

  it('rejects non-uuid names', () => {
    expect(isChatFileName('relatorio.pdf')).toBe(false)
    expect(isChatFileName('123.txt')).toBe(false)
    expect(isChatFileName('')).toBe(false)
    expect(isChatFileName('a1b2c3d4-5678-90ab-cdef.txt')).toBe(false) // too short
  })

  it('rejects non-string values', () => {
    expect(isChatFileName(123)).toBe(false)
    expect(isChatFileName(null)).toBe(false)
    expect(isChatFileName(undefined)).toBe(false)
    expect(isChatFileName({})).toBe(false)
  })
})

describe('saveAndParseChatFile', () => {
  it('saves a TXT file and returns parsed text', async () => {
    const dir = tempDir()
    const data = new Uint8Array(Buffer.from('parágrafo de teste', 'utf-8'))
    const r = await saveAndParseChatFile(dir, 'nota.txt', '.txt', data, makeId)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    const meta = r as ChatDocumentMeta
    expect(meta.name).toBe('nota.txt')
    expect(meta.ext).toBe('.txt')
    expect(meta.text).toContain('parágrafo de teste')
    expect(meta.truncated).toBe(false)
    expect(meta.size).toBeGreaterThan(0)
    // the file is on disk
    expect(existsSync(join(dir, meta.id))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unsupported extension', async () => {
    const dir = tempDir()
    const data = new Uint8Array(Buffer.from('bytes', 'utf-8'))
    const r = await saveAndParseChatFile(dir, 'mal.exe', '.exe', data, makeId)
    expect('error' in r).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects empty data', async () => {
    const dir = tempDir()
    const data = new Uint8Array(0)
    const r = await saveAndParseChatFile(dir, 'vazia.txt', '.txt', data, makeId)
    expect('error' in r).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the directory when it does not exist', async () => {
    const dir = join(tmpdir(), 'chat-files-nonexistent-' + Date.now())
    const data = new Uint8Array(Buffer.from('ok', 'utf-8'))
    const r = await saveAndParseChatFile(dir, 'x.txt', '.txt', data, makeId)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(existsSync(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('deleteChatFiles', () => {
  it('deletes files from disk', () => {
    const dir = tempDir()
    const path = join(dir, 'deleteme.txt')
    writeFileSync(path, 'x', 'utf-8')
    expect(existsSync(path)).toBe(true)
    deleteChatFiles([path])
    expect(existsSync(path)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('silently handles null paths', () => {
    expect(() => deleteChatFiles([null, null])).not.toThrow()
  })

  it('silently handles missing files', () => {
    expect(() => deleteChatFiles(['/tmp/nao-existe-xyz123.txt'])).not.toThrow()
  })
})
