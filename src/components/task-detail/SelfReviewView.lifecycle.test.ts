import {
  renderSelfReviewView,
  setupSelfReviewViewTestSuite,
} from './SelfReviewView.testUtils'
import { waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import { getTaskCommits, getTaskDiff } from '../../lib/ipc'
import type { PrFileDiff } from '../../lib/types'

setupSelfReviewViewTestSuite()

it('does not request commit history when a diff finishes after leaving Self Review', async () => {
  let finishDiff!: (files: PrFileDiff[]) => void
  const pendingDiff = new Promise<PrFileDiff[]>(resolve => { finishDiff = resolve })
  vi.mocked(getTaskDiff).mockReturnValueOnce(pendingDiff)

  const view = renderSelfReviewView()
  await waitFor(() => expect(getTaskDiff).toHaveBeenCalledTimes(1))
  view.unmount()
  finishDiff([])

  // Let the completed request's entire promise chain run before asserting no follow-up I/O.
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(getTaskCommits).not.toHaveBeenCalled()
})
