import { describe, it, expect } from 'vitest'
import { safeAttachmentName } from '../backup-files'

// The id/ext come from a backup file a user could hand-edit, and the result is
// joined onto userData/files to write a blob — so a traversal must resolve to
// null, not to a path. These cases pin that.
describe('safeAttachmentName', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000'

  it('accepts a uuid + normal extension', () => {
    expect(safeAttachmentName(uuid, '.pdf')).toBe(`${uuid}.pdf`)
    expect(safeAttachmentName(uuid, '.docx')).toBe(`${uuid}.docx`)
  })

  it('accepts a uuid with no extension', () => {
    expect(safeAttachmentName(uuid, '')).toBe(uuid)
    expect(safeAttachmentName(uuid, null)).toBe(uuid)
    expect(safeAttachmentName(uuid, undefined)).toBe(uuid)
  })

  it('rejects a non-uuid id', () => {
    expect(safeAttachmentName('not-a-uuid', '.pdf')).toBeNull()
    expect(safeAttachmentName('', '.pdf')).toBeNull()
    expect(safeAttachmentName(42, '.pdf')).toBeNull()
    expect(safeAttachmentName(null, '.pdf')).toBeNull()
  })

  it('rejects a traversal in the id', () => {
    expect(safeAttachmentName('../../ai-config', '.json')).toBeNull()
    expect(safeAttachmentName('..', '')).toBeNull()
    expect(safeAttachmentName(`${uuid}/../evil`, '.pdf')).toBeNull()
  })

  it('rejects an ext carrying a separator or dot-dot', () => {
    expect(safeAttachmentName(uuid, '/etc/passwd')).toBeNull()
    expect(safeAttachmentName(uuid, '.pdf/../..')).toBeNull()
    expect(safeAttachmentName(uuid, '..')).toBeNull()
    expect(safeAttachmentName(uuid, '.a b')).toBeNull() // space is not alnum
  })

  it('rejects a non-string ext', () => {
    expect(safeAttachmentName(uuid, 42)).toBeNull()
    expect(safeAttachmentName(uuid, {})).toBeNull()
  })
})
