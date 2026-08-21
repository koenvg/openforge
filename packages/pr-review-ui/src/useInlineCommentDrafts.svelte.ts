import { SplitSide } from '@git-diff-view/svelte'
import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'

type InlineCommentDraftSide = ReviewSubmissionComment['side']

type GetInlineDraft = (
  scopeId: string,
  filename: string,
  lineNumber: number,
  side: InlineCommentDraftSide,
) => string

type SetInlineDraft = (
  scopeId: string,
  filename: string,
  lineNumber: number,
  side: InlineCommentDraftSide,
  text: string,
) => void

type ClearInlineDraft = (
  scopeId: string,
  filename: string,
  lineNumber: number,
  side: InlineCommentDraftSide,
) => void

interface InlineCommentDraftKey {
  filename: string
  lineNumber: number
  side: InlineCommentDraftSide
}

interface InlineCommentDraftsDependencies {
  getPendingComments: () => ReviewSubmissionComment[] | undefined
  getOnPendingCommentsChange: () => ((comments: ReviewSubmissionComment[]) => void) | undefined
  getInlineDraftScopeId: () => string | undefined
  getInlineDraft: () => GetInlineDraft | undefined
  getSetInlineDraft: () => SetInlineDraft | undefined
  getClearInlineDraft: () => ClearInlineDraft | undefined
}

export interface InlineCommentDraftsState {
  readonly pendingComments: ReviewSubmissionComment[]
  readonly pendingCommentCountByFile: Map<string, number>
  open: (filename: string, lineNumber: number, side: SplitSide) => void
  getText: (filename: string, lineNumber: number, side: SplitSide) => string
  setText: (filename: string, lineNumber: number, side: SplitSide, text: string) => void
  clear: (filename: string, lineNumber: number, side: SplitSide) => void
  submit: (filename: string, lineNumber: number, side: SplitSide, onClose: () => void) => void
  setPendingComments: (comments: ReviewSubmissionComment[]) => void
}

function toReviewSide(side: SplitSide): InlineCommentDraftSide {
  return side === SplitSide.old ? 'LEFT' : 'RIGHT'
}

export function createInlineCommentDrafts(deps: InlineCommentDraftsDependencies): InlineCommentDraftsState {
  let internalPendingComments = $state<ReviewSubmissionComment[]>([])
  let activeDraftKey = $state<InlineCommentDraftKey | null>(null)
  let activeDraftText = $state('')

  const pendingComments = $derived(deps.getPendingComments() ?? internalPendingComments)
  const pendingCommentCountByFile = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const comment of pendingComments) {
      counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1)
    }
    return counts
  })

  function isActiveDraft(filename: string, lineNumber: number, side: InlineCommentDraftSide): boolean {
    return activeDraftKey?.filename === filename &&
      activeDraftKey.lineNumber === lineNumber &&
      activeDraftKey.side === side
  }

  function getText(filename: string, lineNumber: number, side: SplitSide): string {
    const reviewSide = toReviewSide(side)
    if (isActiveDraft(filename, lineNumber, reviewSide)) return activeDraftText

    const scopeId = deps.getInlineDraftScopeId()
    if (!scopeId) return ''
    return deps.getInlineDraft()?.(scopeId, filename, lineNumber, reviewSide) ?? ''
  }

  function open(filename: string, lineNumber: number, side: SplitSide): void {
    const reviewSide = toReviewSide(side)
    const scopeId = deps.getInlineDraftScopeId()
    activeDraftKey = { filename, lineNumber, side: reviewSide }
    activeDraftText = scopeId
      ? deps.getInlineDraft()?.(scopeId, filename, lineNumber, reviewSide) ?? ''
      : ''
  }

  function setText(filename: string, lineNumber: number, side: SplitSide, text: string): void {
    const reviewSide = toReviewSide(side)
    const scopeId = deps.getInlineDraftScopeId()
    activeDraftKey = { filename, lineNumber, side: reviewSide }
    activeDraftText = text
    if (scopeId) deps.getSetInlineDraft()?.(scopeId, filename, lineNumber, reviewSide, text)
  }

  function clear(filename: string, lineNumber: number, side: SplitSide): void {
    const reviewSide = toReviewSide(side)
    const scopeId = deps.getInlineDraftScopeId()
    if (scopeId) deps.getClearInlineDraft()?.(scopeId, filename, lineNumber, reviewSide)
    if (!isActiveDraft(filename, lineNumber, reviewSide)) return
    activeDraftText = ''
    activeDraftKey = null
  }

  function setPendingComments(comments: ReviewSubmissionComment[]): void {
    const onPendingCommentsChange = deps.getOnPendingCommentsChange()
    if (onPendingCommentsChange) {
      onPendingCommentsChange(comments)
      return
    }
    internalPendingComments = comments
  }

  function submit(filename: string, lineNumber: number, side: SplitSide, onClose: () => void): void {
    const body = getText(filename, lineNumber, side).trim()
    if (!body) return

    setPendingComments([
      ...pendingComments,
      {
        path: filename,
        line: lineNumber,
        side: toReviewSide(side),
        body,
      },
    ])
    clear(filename, lineNumber, side)
    onClose()
  }

  return {
    get pendingComments() { return pendingComments },
    get pendingCommentCountByFile() { return pendingCommentCountByFile },
    open,
    getText,
    setText,
    clear,
    submit,
    setPendingComments,
  }
}
