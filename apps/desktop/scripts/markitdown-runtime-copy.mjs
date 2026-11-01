import {
  cpSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function isInside(path, root) {
  return path === root || path.startsWith(root + sep)
}

function* symlinks(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) yield path
    else if (stat.isDirectory()) yield* symlinks(path)
  }
}

/**
 * Copy PyInstaller's onedir output into `target`, leaving no symlink that points
 * back into `source`. fs.cp copies a symlink as a symlink even with
 * `dereference`, and writes its target as an absolute path through the *real*
 * source path. On macOS tmpdir() is /var/folders/…, a link to /private/var/…, so
 * the source must be compared by its real path: otherwise no link matches, every
 * one keeps pointing at the temp dir deleted right after, and electron-builder
 * fails with ENOENT on Python.framework.
 */
export function copyPyInstallerBundle(source, target) {
  const sourceRoot = realpathSync(source)
  cpSync(sourceRoot, target, { recursive: true, dereference: true })

  for (const path of symlinks(target)) {
    const original = readlinkSync(path)
    if (isAbsolute(original) && isInside(original, sourceRoot)) {
      const destination = join(target, relative(sourceRoot, original))
      rmSync(path)
      symlinkSync(relative(dirname(path), destination), path)
    }
  }

  // Fail here, naming the link, rather than in electron-builder after the temp
  // dir is gone.
  const roots = [resolve(target), realpathSync(target)]
  const escaped = [...symlinks(target)].filter((path) => {
    const original = readlinkSync(path)
    const resolved = isAbsolute(original) ? original : resolve(dirname(path), original)
    return !roots.some((root) => isInside(resolved, root))
  })
  if (escaped.length > 0) {
    throw new Error(
      `Links do runtime MarkItDown apontam para fora de ${target}:\n` +
        escaped.map((path) => `  ${path} -> ${readlinkSync(path)}`).join('\n')
    )
  }
}
