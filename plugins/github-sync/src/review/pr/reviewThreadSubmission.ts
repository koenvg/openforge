import type { ReviewThread, ReviewThreadStatus } from '@openforge-app/plugin-sdk'
import type { PrFileDiff, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import { placeReviewThreads } from '@openforge-app/pr-review-ui/reviewThreadAnchors'

export interface ReviewThreadSubmission {
  threadId: string
  comment: ReviewSubmissionComment
}

export function resolvedAgentThreadSubmissions(
  files: PrFileDiff[],
  threads: ReviewThread[],
): ReviewThreadSubmission[] {
  const seen = new Set<string>()
  const submissions: ReviewThreadSubmission[] = []
  const anchoredThreadIds = new Set(placeReviewThreads(files, threads).anchored.map(thread => thread.id))

  for (const thread of threads) {
    if (seen.has(thread.id)
      || !anchoredThreadIds.has(thread.id)
      || thread.origin !== 'agent'
      || thread.status !== 'resolved'
      || thread.anchor.kind !== 'line') continue

    const body = thread.messages.find(message => message.role === 'agent')?.body.trim()
    if (!body) continue

    seen.add(thread.id)
    submissions.push({
      threadId: thread.id,
      comment: {
        path: thread.anchor.filePath,
        line: thread.anchor.line,
        side: thread.anchor.side,
        body,
      },
    })
  }

  return submissions
}

export async function dismissSubmittedReviewThreads(
  threadIds: string[],
  setStatus: (threadId: string, status: ReviewThreadStatus) => Promise<void> | void,
): Promise<void> {
  await Promise.all(threadIds.map(threadId => setStatus(threadId, 'dismissed')))
}
