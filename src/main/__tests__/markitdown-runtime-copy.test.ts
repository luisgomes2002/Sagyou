// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { copyPyInstallerBundle } from '../../../scripts/markitdown-runtime-copy.mjs'

// Creating file symlinks needs a privilege Windows withholds by default; the
// release runners (macOS, Linux) and CI have it.
function canSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'sagyou-symlink-probe-'))
  try {
    writeFileSync(join(dir, 'file'), '')
    symlinkSync('file', join(dir, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(!canSymlink())('copyPyInstallerBundle', () => {
  let base: string

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  /** A PyInstaller-like bundle reached through `alias`, a link to its real dir — like macOS's /var -> /private/var. */
  function bundleBehindAlias(): { source: string; target: string } {
    base = mkdtempSync(join(tmpdir(), 'sagyou-markitdown-copy-'))
    const real = join(base, 'private-var')
    const framework = join(real, 'dist', '_internal', 'Python.framework')
    mkdirSync(join(framework, 'Versions', '3.12'), { recursive: true })
    writeFileSync(join(framework, 'Versions', '3.12', 'Python'), 'python binary')
    symlinkSync('3.12', join(framework, 'Versions', 'Current'), 'dir')
    symlinkSync(join('Versions', 'Current', 'Python'), join(framework, 'Python'), 'file')
    symlinkSync(join(real, 'dist'), join(base, 'var'), 'dir')
    return { source: join(base, 'var'), target: join(base, 'runtime') }
  }

  // The macOS release failed with ENOENT on Python.framework/Versions/3.12/Python:
  // the copied links still pointed into the temp dir, which was deleted.
  it('leaves no link pointing into the source when it is reached through a symlink', () => {
    const { source, target } = bundleBehindAlias()

    copyPyInstallerBundle(source, target)
    // The build deletes its temp dir right after copying.
    rmSync(join(base, 'private-var'), { recursive: true, force: true })
    rmSync(join(base, 'var'), { force: true })

    const framework = join(target, '_internal', 'Python.framework')
    for (const link of [join(framework, 'Python'), join(framework, 'Versions', 'Current')])
      expect(isAbsolute(readlinkSync(link))).toBe(false)
    expect(readFileSync(join(framework, 'Python'), 'utf8')).toBe('python binary')
    expect(existsSync(join(framework, 'Versions', 'Current', 'Python'))).toBe(true)
  })

  it('refuses a bundle with a link that escapes the runtime', () => {
    const { source, target } = bundleBehindAlias()
    writeFileSync(join(base, 'outside'), 'not bundled')
    symlinkSync(join(base, 'outside'), join(base, 'private-var', 'dist', 'escape'), 'file')

    expect(() => copyPyInstallerBundle(source, target)).toThrow(/apontam para fora/)
  })
})
