// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { reviewFinalDiff } from '../final-diff-review'

describe('reviewFinalDiff', () => {
  it('only reports approval after an explicit affirmative answer', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true)

    await expect(reviewFinalDiff({ patch: 'diff --git a/a b/a', requestApproval })).resolves.toBe(
      'approved'
    )
    expect(requestApproval).toHaveBeenCalledTimes(1)
  })

  it('keeps the patch isolated when the final review is denied', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false)

    await expect(reviewFinalDiff({ patch: 'diff --git a/a b/a', requestApproval })).resolves.toBe(
      'denied'
    )
  })

  it('distinguishes an empty completed diff from a review that is still required', async () => {
    const requestApproval = vi.fn()

    await expect(reviewFinalDiff({ patch: '', requestApproval })).resolves.toBe('empty')
    expect(requestApproval).not.toHaveBeenCalled()
  })
})
