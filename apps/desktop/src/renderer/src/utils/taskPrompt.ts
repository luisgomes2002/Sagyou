import type { Task } from '../types'
import { PRIORITY_CONFIG } from '../types'

// Handing a board task to the assistant, as the text that lands in the composer.
//
// Why a prompt and not one of the obvious alternatives:
//
// - **Copying the id** puts a UUID in the chat. It reads as nothing to the user,
//   and the model has to spend a paid `ler_tasks` step to find out what it is.
// - **Copying the task's text** (TaskViewModal's clipboard button) is a snapshot
//   with no id, so the model can describe the task but cannot act on it —
//   `mover_task`, `concluir_task`, `atualizar_task` and the timer all key off the
//   id. That button stays what it is: text for a human to paste elsewhere.
//
// So this carries both: prose the user can read back in the transcript, and the
// ids the tools need. It is deliberately **context only, with no instruction** —
// "implemente", "quebre em subtasks" and "por que isso travou?" are different
// asks, and guessing wrong makes the user delete a line before every send.

/** Longest description carried over. A task body can be an essay; this is a briefing. */
export const MAX_PROMPT_DESCRIPTION = 1500

/**
 * The composer text for handing `task` to the assistant.
 *
 * ⚠️ **`projectId` is included on purpose.** `ler_tasks` reads one project — the
 * one asked for, or the active one — so a task handed over from another board
 * would otherwise be invisible to every tool the model reached for. Naming the
 * project id up front is what stops "essa task não existe" about a task the user
 * is looking at.
 */
export function buildTaskPrompt(task: Task, projectName: string, columnName: string): string {
  const meta = [
    `id: ${task.id}`,
    `projectId: ${task.projectId}`,
    projectName && `projeto: ${projectName}`,
    columnName && `coluna: ${columnName}`,
    `prioridade: ${PRIORITY_CONFIG[task.priority]?.label ?? task.priority}`,
    task.dueDate && `vencimento: ${task.dueDate}`
  ].filter(Boolean)

  const lines = [`Task "${task.title}" (${meta.join(', ')})`]

  const description = task.description?.trim()
  if (description) {
    lines.push('')
    lines.push(
      description.length > MAX_PROMPT_DESCRIPTION
        ? `${description.slice(0, MAX_PROMPT_DESCRIPTION)}…`
        : description
    )
  }

  if (task.tags.length > 0) {
    lines.push('')
    lines.push(`Tags: ${task.tags.join(', ')}`)
  }

  // Trailing blank line: the cursor lands where the user writes what they want
  // done, instead of at the end of the metadata.
  lines.push('')
  lines.push('')
  return lines.join('\n')
}
