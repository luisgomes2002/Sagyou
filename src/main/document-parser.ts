import { readFileSync } from 'node:fs'

/**
 * Text extraction from binary document formats.
 *
 * Pure functions, no Electron imports — the rules are testable on their own.
 * Uses pdfjs-dist (legacy build for Node.js) for PDF and mammoth for DOCX.
 * XLSX uses the project's existing `xlsx` dependency. CSV and plain text
 * formats need no library: they're already text.
 *
 * A parsed document's text is capped — the model re-sends the whole
 * conversation on every step, so an unchecked 200-page PDF is not just
 * expensive to parse but also to re-read from context many times over.
 */

/** Parsed text from a known document type. */
export interface ParsedDocument {
  text: string
  /** True when the extracted text exceeded the cap and was cut. */
  truncated: boolean
  /** Original file size in bytes, for the caller to report. */
  size: number
}

/** Byte ceiling on an uploaded document. Larger files are rejected outright. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** Characters to return before cutting. The model pays every token again. */
export const MAX_DOCUMENT_CHARS = 50_000

// ---- supported extensions ----

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet'
}

export function supportedExtensions(): string[] {
  return Object.keys(EXT_MIME)
}

export function isDocumentExt(ext: string): boolean {
  return ext.toLowerCase() in EXT_MIME
}

export function mimeForDocumentExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

// ---- plain text (CSV, TXT, MD, JSON, YAML, XML, HTML, LOG) ----

function parseText(buffer: Buffer): ParsedDocument {
  const raw = buffer.toString('utf-8')
  const text = raw.length > MAX_DOCUMENT_CHARS ? raw.slice(0, MAX_DOCUMENT_CHARS) : raw
  return { text, truncated: raw.length > MAX_DOCUMENT_CHARS, size: buffer.length }
}

// ---- CSV (special: format as a readable table for the model) ----

function parseCsv(buffer: Buffer): ParsedDocument {
  const raw = buffer.toString('utf-8')
  const rows = raw.trim().split(/\r?\n/)
  if (rows.length === 0) return { text: '', truncated: false, size: buffer.length }

  const cells = rows.map((r) => r.split(',').map((c) => c.trim()))
  const colWidths: number[] = []
  const cap = Math.min(cells.length, 200)
  for (let i = 0; i < cap; i++) {
    for (let j = 0; j < cells[i].length; j++) {
      colWidths[j] = Math.max(colWidths[j] ?? 3, cells[i][j].length)
    }
  }

  const colPad = colWidths.map((w) => w + 2)
  const fmt = (row: string[]) => row.map((c, i) => c.padEnd(colPad[i] ?? 4)).join('')

  const header = cells[0].length > 0 && cells.length > 0
  const lines: string[] = []
  if (header) {
    lines.push(fmt(cells[0]))
    lines.push(colPad.map((w) => '-'.repeat(w)).join(''))
    for (let i = 1; i < cap; i++) lines.push(fmt(cells[i]))
  } else {
    for (let i = 0; i < cap; i++) lines.push(fmt(cells[i]))
  }
  if (rows.length > cap) lines.push(`... mais ${rows.length - cap} linha(s) omitida(s)`)

  let text = lines.join('\n')
  if (text.length > MAX_DOCUMENT_CHARS) text = text.slice(0, MAX_DOCUMENT_CHARS)
  return { text, truncated: raw.length > MAX_DOCUMENT_CHARS || rows.length > cap, size: buffer.length }
}

// ---- XLSX (existing `xlsx` dependency) ----

function parseXlsx(buffer: Buffer): ParsedDocument {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  const cap = Math.min(wb.SheetNames.length, 10)
  for (let i = 0; i < cap; i++) {
    const name = wb.SheetNames[i]
    const ws = wb.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ', ', RS: '\n' })
    parts.push(`--- Aba: ${name} ---\n${csv}`)
  }
  if (wb.SheetNames.length > cap) {
    parts.push(`... mais ${wb.SheetNames.length - cap} aba(s) omitida(s)`)
  }
  let text = parts.join('\n\n')
  if (text.length > MAX_DOCUMENT_CHARS) text = text.slice(0, MAX_DOCUMENT_CHARS)
  return { text, truncated: text.length >= MAX_DOCUMENT_CHARS, size: buffer.length }
}

// ---- PDF (pdfjs-dist legacy build) ----

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data, disableAutoFetch: true, disableStream: true }).promise
  const pages: string[] = []
  const maxPages = Math.min(doc.numPages, 100)
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (pageText) pages.push(`--- Página ${i} ---\n${pageText}`)
    // let the gc collect the page objects as we go
    page.cleanup()
  }
  let text = pages.join('\n\n')
  if (doc.numPages > maxPages) {
    text += `\n\n... mais ${doc.numPages - maxPages} página(s) omitida(s)`
  }
  if (text.length > MAX_DOCUMENT_CHARS) text = text.slice(0, MAX_DOCUMENT_CHARS)
  return { text, truncated: text.length >= MAX_DOCUMENT_CHARS || doc.numPages > maxPages, size: buffer.length }
}

// ---- DOCX (mammoth) ----

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  let text = result.value
  if (text.length > MAX_DOCUMENT_CHARS) text = text.slice(0, MAX_DOCUMENT_CHARS)
  return { text, truncated: text.length >= MAX_DOCUMENT_CHARS, size: buffer.length }
}

// ---- dispatcher ----

/**
 * Parse a document by its extension (".pdf", ".docx", etc.). Returns the
 * extracted text or an error.
 *
 * Files up to MAX_DOCUMENT_BYTES are accepted. Text is always capped at
 * MAX_DOCUMENT_CHARS; `truncated` is true when the original was longer.
 */
export async function parseDocument(
  filePath: string,
  ext: string
): Promise<ParsedDocument | { error: string }> {
  const key = ext.toLowerCase()
  if (!isDocumentExt(key)) {
    return { error: `Tipo de arquivo não suportado: ${ext}` }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(filePath)
  } catch {
    return { error: 'Não foi possível ler o arquivo' }
  }
  if (buffer.length === 0) return { error: 'Arquivo vazio' }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { error: `Arquivo grande demais (máx. ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB)` }
  }

  try {
    switch (key) {
      case '.pdf':
        return await parsePdf(buffer)
      case '.docx':
      case '.odt':
        return await parseDocx(buffer)
      case '.xlsx':
      case '.ods':
        return parseXlsx(buffer)
      case '.csv':
        return parseCsv(buffer)
      case '.rtf':
        return parseText(buffer)
      default:
        return parseText(buffer)
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao processar o documento' }
  }
}

/**
 * Parse document bytes straight from a buffer (for use when the file doesn't
 * live on disk yet, e.g. during upload). `ext` is the bare extension (".pdf").
 */
export async function parseDocumentBuffer(
  buffer: Buffer,
  ext: string
): Promise<ParsedDocument | { error: string }> {
  const key = ext.toLowerCase()
  if (!isDocumentExt(key)) {
    return { error: `Tipo de arquivo não suportado: ${ext}` }
  }
  if (buffer.length === 0) return { error: 'Arquivo vazio' }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { error: `Arquivo grande demais (máx. ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB)` }
  }

  try {
    switch (key) {
      case '.pdf':
        return await parsePdf(buffer)
      case '.docx':
      case '.odt':
        return await parseDocx(buffer)
      case '.xlsx':
      case '.ods':
        return parseXlsx(buffer)
      case '.csv':
        return parseCsv(buffer)
      case '.rtf':
        return parseText(buffer)
      default:
        return parseText(buffer)
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao processar o documento' }
  }
}
