import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface DeliveryCoordinator {
  hasDirectRun(dir: string, exceptRunId: string): boolean
  waitForDirectRun(dir: string, exceptRunId: string): Promise<boolean>
  deliver<T>(dir: string, action: () => Promise<T>): Promise<T>
}

export interface DeliverPatchOptions {
  originalDir: string
  runId: string
  patch: string
  coordinator: DeliveryCoordinator
  onWaitingForDirectRun?: () => void
}

/** Applies an approved patch through the existing serialized delivery gate. */
export async function deliverApprovedPatch(options: DeliverPatchOptions): Promise<void> {
  const { originalDir, runId, patch, coordinator } = options
  if (coordinator.hasDirectRun(originalDir, runId)) {
    options.onWaitingForDirectRun?.()
    await coordinator.waitForDirectRun(originalDir, runId)
  }
  await coordinator.deliver(originalDir, async () => {
    const patchPath = join(originalDir, `.sagyou-wt-patch-${runId}.diff`)
    await writeFile(patchPath, patch, 'utf8')
    try {
      await execFileAsync(
        'git',
        [
          '-C',
          originalDir,
          'apply',
          '--whitespace=nowarn',
          '--ignore-space-change',
          '--ignore-whitespace',
          patchPath
        ],
        { windowsHide: true }
      )
    } finally {
      await unlink(patchPath).catch(() => {})
    }
  })
}
