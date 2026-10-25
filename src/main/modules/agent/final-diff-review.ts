/**
 * The final delivery gate deliberately has no auto-approve input. Auto mode
 * may let an agent work inside its isolated worktree, but only this explicit
 * decision can move its patch into the user's real project.
 */
export type FinalDiffReviewResult = 'empty' | 'denied' | 'approved'

export async function reviewFinalDiff(options: {
  patch: string
  requestApproval: () => Promise<boolean>
}): Promise<FinalDiffReviewResult> {
  if (!options.patch.trim()) return 'empty'
  if (!(await options.requestApproval())) return 'denied'
  return 'approved'
}
