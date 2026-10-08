import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export const MARKITDOWN_TIMEOUT_MS = 30_000

interface MarkItDownResponse {
  text?: unknown
  truncated?: unknown
  error?: unknown
}

export interface MarkItDownResult {
  text: string
  truncated: boolean
}

/**
 * The PyInstaller bundle is generated on the matching release runner and is
 * copied by electron-builder as an extra resource. Users never need Python.
 */
export function markitdownBinaryPath(
  resourcesPath = process.resourcesPath || join(process.cwd(), 'resources'),
  platform = process.platform,
  arch = process.arch
): string {
  const executable = platform === 'win32' ? 'sagyou-markitdown.exe' : 'sagyou-markitdown'
  return join(resourcesPath, 'markitdown', `${platform}-${arch}`, executable)
}

export function hasBundledMarkItDown(
  resourcesPath: string | undefined = process.resourcesPath,
  platform = process.platform,
  arch = process.arch
): boolean {
  if (!resourcesPath) return false
  return existsSync(markitdownBinaryPath(resourcesPath, platform, arch))
}

export async function convertWithMarkItDown(
  filePath: string
): Promise<MarkItDownResult | { error: string }> {
  const binary = markitdownBinaryPath()
  if (!existsSync(binary)) {
    return { error: 'Runtime do MarkItDown não está disponível nesta instalação' }
  }

  try {
    const { stdout } = await execFileAsync(binary, [filePath], {
      timeout: MARKITDOWN_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    })
    const response = JSON.parse(stdout) as MarkItDownResponse
    if (typeof response.error === 'string') return { error: response.error }
    if (typeof response.text !== 'string' || typeof response.truncated !== 'boolean') {
      return { error: 'Resposta inválida do MarkItDown' }
    }
    return { text: response.text, truncated: response.truncated }
  } catch (error) {
    if (error instanceof Error && 'killed' in error && error.killed) {
      return { error: 'A conversão do documento excedeu 30 segundos' }
    }
    return { error: 'Não foi possível executar o MarkItDown' }
  }
}
