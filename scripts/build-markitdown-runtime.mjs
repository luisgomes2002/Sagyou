import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'resources', 'markitdown')
const requirements = join(sourceDir, 'requirements.txt')
const runner = join(sourceDir, 'runner.py')
const target = join(sourceDir, 'bin', `${process.platform}-${process.arch}`)
const binary = join(
  target,
  process.platform === 'win32' ? 'sagyou-markitdown.exe' : 'sagyou-markitdown'
)
const BUILD_REVISION = 4

function rewritePyInstallerLinks(dir, sourceRoot) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isDirectory()) {
      rewritePyInstallerLinks(path, sourceRoot)
    } else if (stat.isSymbolicLink()) {
      const original = readlinkSync(path)
      if (original.startsWith(sourceRoot)) {
        const destination = join(target, relative(sourceRoot, original))
        rmSync(path)
        symlinkSync(relative(dirname(path), destination), path)
      }
    }
  }
}

function pythonCommand() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next conventional Python command.
    }
  }
  throw new Error('Python 3.10+ é necessário somente para gerar o runtime do MarkItDown.')
}

function runtimeIsCurrent() {
  const manifest = join(target, 'manifest.json')
  if (!existsSync(binary) || !existsSync(manifest)) return false
  try {
    const saved = JSON.parse(readFileSync(manifest, 'utf8'))
    return (
      saved.requirements === readFileSync(requirements, 'utf8') &&
      saved.runner === readFileSync(runner, 'utf8') &&
      saved.buildRevision === BUILD_REVISION
    )
  } catch {
    return false
  }
}

if (runtimeIsCurrent()) {
  console.log(`MarkItDown já está pronto em ${target}`)
  process.exit(0)
}

const python = pythonCommand()
const temp = mkdtempSync(join(tmpdir(), 'sagyou-markitdown-'))
const venv = join(temp, 'venv')
const venvPython = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const dist = join(temp, 'dist')

try {
  console.log('Preparando o runtime empacotado do MarkItDown…')
  execFileSync(python, ['-m', 'venv', venv], { stdio: 'inherit' })
  execFileSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' })
  execFileSync(venvPython, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' })
  execFileSync(
    venvPython,
    [
      '-m',
      'PyInstaller',
      '--noconfirm',
      '--clean',
      '--onedir',
      '--name',
      'sagyou-markitdown',
      '--collect-all',
      'markitdown',
      '--collect-all',
      'magika',
      '--collect-all',
      'pandas',
      '--collect-all',
      'openpyxl',
      '--collect-all',
      'pdfplumber',
      '--collect-all',
      'pytesseract',
      '--distpath',
      dist,
      '--workpath',
      join(temp, 'work'),
      '--specpath',
      join(temp, 'spec'),
      runner
    ],
    { stdio: 'inherit' }
  )
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  // PyInstaller's native wheels contain absolute symlinks. Rewrite those links
  // after copying, otherwise electron-builder follows them into this temp dir.
  cpSync(join(dist, 'sagyou-markitdown'), target, { recursive: true, dereference: true })
  rewritePyInstallerLinks(target, join(dist, 'sagyou-markitdown'))
  writeFileSync(
    join(target, 'manifest.json'),
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      requirements: readFileSync(requirements, 'utf8'),
      runner: readFileSync(runner, 'utf8'),
      buildRevision: BUILD_REVISION
    })
  )
  console.log(`Runtime MarkItDown criado em ${target}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
