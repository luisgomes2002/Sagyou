/**
 * Tests for document-parser.ts — the pure parsing rules (no Electron).
 *
 * PDF and DOCX parsing need real binary buffers, so they're tested here
 * with minimal smoke tests. The CSV, TXT, and size-limit logic is covered
 * in detail because those rules affect every chat run's cost.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import {
  isDocumentExt,
  supportedExtensions,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_CHARS,
  parseDocument,
  parseDocumentBuffer
} from '../../main/document-parser'

function tempFile(ext: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-test-'))
  const path = join(dir, `test${ext}`)
  writeFileSync(path, content, 'utf-8')
  return path
}

describe('isDocumentExt', () => {
  it('recognizes supported extensions', () => {
    expect(isDocumentExt('.pdf')).toBe(true)
    expect(isDocumentExt('.docx')).toBe(true)
    expect(isDocumentExt('.xlsx')).toBe(true)
    expect(isDocumentExt('.csv')).toBe(true)
    expect(isDocumentExt('.txt')).toBe(true)
    expect(isDocumentExt('.md')).toBe(true)
    expect(isDocumentExt('.json')).toBe(true)
    expect(isDocumentExt('.html')).toBe(true)
    expect(isDocumentExt('.yml')).toBe(true)
    expect(isDocumentExt('.rtf')).toBe(true)
    expect(isDocumentExt('.odt')).toBe(true)
    expect(isDocumentExt('.ods')).toBe(true)
  })

  it('rejects unsupported extensions', () => {
    expect(isDocumentExt('.exe')).toBe(false)
    expect(isDocumentExt('.bin')).toBe(false)
    expect(isDocumentExt('.zip')).toBe(false)
    expect(isDocumentExt('')).toBe(false)
    expect(isDocumentExt('.PNG')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isDocumentExt('.PDF')).toBe(true)
    expect(isDocumentExt('.Docx')).toBe(true)
  })
})

describe('supportedExtensions', () => {
  it('returns a non-empty list with pdf first', () => {
    const list = supportedExtensions()
    expect(list.length).toBeGreaterThanOrEqual(10)
    expect(list).toContain('.pdf')
    expect(list).toContain('.docx')
  })
})

describe('parseDocumentBuffer – plain text formats', () => {
  it('parses a TXT file', async () => {
    const buf = Buffer.from('olá mundo\nsegunda linha', 'utf-8')
    const r = await parseDocumentBuffer(buf, '.txt')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('olá mundo')
    expect(r.text).toContain('segunda linha')
    expect(r.truncated).toBe(false)
  })

  it('parses a JSON file', async () => {
    const buf = Buffer.from(JSON.stringify({ chave: 'valor' }), 'utf-8')
    const r = await parseDocumentBuffer(buf, '.json')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('chave')
  })

  it('parses an MD file', async () => {
    const buf = Buffer.from('# Título\nTexto **negrito**', 'utf-8')
    const r = await parseDocumentBuffer(buf, '.md')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('Título')
  })

  it('parses an HTML file', async () => {
    const buf = Buffer.from('<html><body>texto</body></html>', 'utf-8')
    const r = await parseDocumentBuffer(buf, '.html')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('texto')
  })
})

describe('parseDocumentBuffer – CSV', () => {
  it('formats a CSV as a readable table with header', async () => {
    const buf = Buffer.from('nome,idade,cidade\nAna,30,SP\nBeto,25,RJ', 'utf-8')
    const r = await parseDocumentBuffer(buf, '.csv')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('nome')
    expect(r.text).toContain('idade')
    expect(r.text).toContain('Ana')
    expect(r.text).toContain('Beto')
    expect(r.truncated).toBe(false)
  })

  it('handles a CSV with no rows', async () => {
    const buf = Buffer.from('nome,idade\n', 'utf-8')
    const r = await parseDocumentBuffer(buf, '.csv')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('nome')
    expect(r.text).toContain('---')
  })
})

describe('parseDocumentBuffer – size limits', () => {
  it('rejects an empty buffer', async () => {
    const r = await parseDocumentBuffer(Buffer.alloc(0), '.txt')
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toBe('Arquivo vazio')
  })

  it('rejects a buffer over the cap', async () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 65) // filled with 'A'
    const r = await parseDocumentBuffer(big, '.txt')
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('grande demais')
  })

  it('truncates text past the char limit', async () => {
    const longText = 'X'.repeat(MAX_DOCUMENT_CHARS + 100)
    const buf = Buffer.from(longText, 'utf-8')
    const r = await parseDocumentBuffer(buf, '.txt')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.truncated).toBe(true)
      expect(r.text.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHARS)
    }
  })

  it('rejects an unsupported type', async () => {
    const r = await parseDocumentBuffer(Buffer.from('data'), '.exe')
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('não suportado')
  })
})

describe('parseDocument – from disk', () => {
  it('parses a TXT file from disk', async () => {
    const path = tempFile('.txt', 'conteúdo do arquivo')
    const r = await parseDocument(path, '.txt')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.text).toContain('conteúdo do arquivo')
    rmSync(path)
  })

  it('returns an error for a non-existent file', async () => {
    const r = await parseDocument('/tmp/nao-existe-xyz.txt', '.txt')
    expect('error' in r).toBe(true)
  })

  it('rejects an unsupported extension', async () => {
    const r = await parseDocument('/tmp/nao-existe.exe', '.exe')
    expect('error' in r).toBe(true)
    if ('error' in r) expect(r.error).toContain('não suportado')
  })
})
