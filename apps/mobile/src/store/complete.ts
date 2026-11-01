import * as Haptics from 'expo-haptics'
import { useApp } from './app'
import { NO_DONE_COLUMN_TEXT, completeTask, revertCompletion } from './tasks'
import { useUndo } from './undo'

export const COMPLETED_TEXT = 'Tarefa concluída'

/**
 * Concluir from a row (swipe or screen reader action): Done column, a light
 * tap, and "Desfazer" for 5 s. A project without a Done column only gets a
 * notice; a read-only phone gets nothing (commit refuses).
 */
export function completeFromList(taskId: string): void {
  const { state, commit } = useApp.getState()
  const before = state.tasks.find((t) => t.id === taskId)
  const next = completeTask(state, taskId, new Date())
  if (!before || next === state) {
    useUndo.getState().show(NO_DONE_COLUMN_TEXT)
    return
  }
  if (!commit(next)) return
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  useUndo.getState().show(COMPLETED_TEXT, () => {
    const app = useApp.getState()
    app.commit(revertCompletion(app.state, before, new Date()))
  })
}
