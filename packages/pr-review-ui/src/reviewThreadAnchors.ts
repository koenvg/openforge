import type { ReviewThread, ReviewThreadAnchor } from '@openforge-app/plugin-sdk'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { commentableLines, type PatchLines } from './patchLines'

export type ReviewThreadLineAnchor = Extract<ReviewThreadAnchor, { kind: 'line' }>

export type LineAnchoredReviewThread = ReviewThread & { anchor: ReviewThreadLineAnchor }

export type OrphanedThreadReason = 'file-not-in-diff' | 'line-not-in-diff'

export interface OrphanedReviewThread {
  thread: LineAnchoredReviewThread
  reason: OrphanedThreadReason
}

export interface ReviewThreadPlacement {
  anchored: ReviewThread[]
  orphaned: OrphanedReviewThread[]
}

function isLineAnchored(thread: ReviewThread): thread is LineAnchoredReviewThread {
  return thread.anchor.kind === 'line'
}

/**
 * Splits threads into the ones the diff can place on a line and the ones it
 * cannot, so an unplaceable thread is reported rather than dropped. Anchors
 * this surface does not own, such as walkthrough steps, land in neither group.
 */
export function placeReviewThreads(
  files: PrFileDiff[],
  threads: ReviewThread[],
): ReviewThreadPlacement {
  const anchored: ReviewThread[] = []
  const orphaned: OrphanedReviewThread[] = []
  const filesByName = new Map(files.map(file => [file.filename, file]))
  const shownLinesByName = new Map<string, PatchLines>()

  function shownLines(file: PrFileDiff): PatchLines {
    let lines = shownLinesByName.get(file.filename)
    if (!lines) {
      lines = commentableLines(file.patch)
      shownLinesByName.set(file.filename, lines)
    }
    return lines
  }

  for (const thread of threads) {
    if (!isLineAnchored(thread)) continue

    const file = filesByName.get(thread.anchor.filePath)
    if (!file) {
      orphaned.push({ thread, reason: 'file-not-in-diff' })
      continue
    }

    const lines = shownLines(file)
    const shown = thread.anchor.side === 'LEFT' ? lines.left : lines.right
    if (shown.has(thread.anchor.line)) {
      anchored.push(thread)
    } else {
      orphaned.push({ thread, reason: 'line-not-in-diff' })
    }
  }

  return { anchored, orphaned }
}
