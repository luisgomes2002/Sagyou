/**
 * Main-process code: runs in Node, not the suite's default jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { resolve, sep } from 'path'
import { confineToRoot } from '../modules/code/code-files'

describe('confineToRoot', () => {
  it('resolves a path inside the root', () => {
    expect(confineToRoot('/project', 'src/a.ts')).toBe(resolve('/project/src/a.ts'))
  })

  it('allows the root itself', () => {
    expect(confineToRoot('/project', '.')).toBe(resolve('/project'))
  })

  it('refuses to climb out', () => {
    // The only thing between the assistant and the rest of the disk.
    expect(confineToRoot('/project', '../secrets')).toBeNull()
    expect(confineToRoot('/project', '../../etc/passwd')).toBeNull()
    expect(confineToRoot('/project', 'src/../../outside')).toBeNull()
  })

  it('refuses an absolute path elsewhere', () => {
    expect(confineToRoot('/project', '/etc/passwd')).toBeNull()
  })

  it('does not mistake a sibling with the same prefix for a child', () => {
    // "/project-evil" starts with "/project" as a string but is not inside it.
    expect(confineToRoot('/project', `..${sep}project-evil${sep}x`)).toBeNull()
  })
})
