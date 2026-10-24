/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { decodeDataUrl, mimeForExt, MAX_IMAGE_BYTES } from '../modules/files/image-files'

const b64 = (s: string): string => Buffer.from(s).toString('base64')
const png = `data:image/png;base64,${b64('fake png bytes')}`

describe('decodeDataUrl', () => {
  it('pulls the bytes and the extension out', () => {
    const res = decodeDataUrl(png)
    expect(res).toMatchObject({ ext: 'png', mime: 'image/png' })
    expect('bytes' in res && res.bytes.toString()).toBe('fake png bytes')
  })

  it('takes the formats a vision model reads', () => {
    for (const [mime, ext] of [
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif']
    ]) {
      expect(decodeDataUrl(`data:${mime};base64,${b64('x')}`)).toMatchObject({ ext })
    }
  })

  it('refuses a data URL that is not an image', () => {
    // Otherwise `data:text/html,<script>` gets written to disk as an "image".
    expect(decodeDataUrl(`data:text/html;base64,${b64('<script>')}`)).toMatchObject({
      error: expect.stringContaining('não suportado')
    })
    expect(decodeDataUrl(`data:application/json;base64,${b64('{}')}`)).toHaveProperty('error')
  })

  it('refuses anything that is not a base64 data URL', () => {
    for (const bad of ['', '   ', 'https://example.com/a.png', 'data:image/png,notbase64', null, 42]) {
      expect(decodeDataUrl(bad)).toHaveProperty('error')
    }
  })

  it('refuses an image bigger than the ceiling', () => {
    // A backstop against a hand-made IPC call; the renderer downscales first.
    const huge = `data:image/png;base64,${'A'.repeat(MAX_IMAGE_BYTES * 2)}`
    expect(decodeDataUrl(huge)).toMatchObject({ error: expect.stringContaining('grande demais') })
  })

  it('refuses an empty payload', () => {
    expect(decodeDataUrl('data:image/png;base64,')).toHaveProperty('error')
  })
})

describe('mimeForExt', () => {
  it('maps back to the stored type', () => {
    expect(mimeForExt('png')).toBe('image/png')
    expect(mimeForExt('jpg')).toBe('image/jpeg')
  })

  it('does not guess for something it never wrote', () => {
    expect(mimeForExt('exe')).toBe('application/octet-stream')
  })
})
