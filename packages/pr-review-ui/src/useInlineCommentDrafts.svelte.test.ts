import { SplitSide } from '@git-diff-view/svelte'
import type { ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import { describe, expect, it, vi } from 'vitest'
import { createInlineCommentDrafts, type InlineCommentDraftsState } from './useInlineCommentDrafts.svelte'

type ReviewSide = ReviewSubmissionComment['side']

function createDraftState(overrides: {
  pendingComments?: ReviewSubmissionComment[]
  onPendingCommentsChange?: (comments: ReviewSubmissionComment[]) => void
  inlineDraftScopeId?: string
  getInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSide) => string
  setInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSide, text: string) => void
  clearInlineDraft?: (scopeId: string, filename: string, lineNumber: number, side: ReviewSide) => void
} = {}) {
  let state!: InlineCommentDraftsState
  const cleanup = $effect.root(() => {
    state = createInlineCommentDrafts({
      getPendingComments: () => overrides.pendingComments,
      getOnPendingCommentsChange: () => overrides.onPendingCommentsChange,
      getInlineDraftScopeId: () => overrides.inlineDraftScopeId,
      getInlineDraft: () => overrides.getInlineDraft,
      getSetInlineDraft: () => overrides.setInlineDraft,
      getClearInlineDraft: () => overrides.clearInlineDraft,
    })
  })
  return { state, cleanup }
}

describe('createInlineCommentDrafts', () => {
  it('opens the persisted draft for the selected line and side', () => {
    const getInlineDraft = vi.fn(() => 'saved draft')
    const { state, cleanup } = createDraftState({ inlineDraftScopeId: 'review-42', getInlineDraft })

    state.open('src/main.ts', 12, SplitSide.old)

    expect(state.getText('src/main.ts', 12, SplitSide.old)).toBe('saved draft')
    expect(getInlineDraft).toHaveBeenCalledWith('review-42', 'src/main.ts', 12, 'LEFT')
    cleanup()
  })

  it('updates the active draft and persists it when a scope is configured', () => {
    const setInlineDraft = vi.fn()
    const { state, cleanup } = createDraftState({ inlineDraftScopeId: 'review-42', setInlineDraft })

    state.setText('src/main.ts', 18, SplitSide.new, 'Needs a guard')

    expect(state.getText('src/main.ts', 18, SplitSide.new)).toBe('Needs a guard')
    expect(setInlineDraft).toHaveBeenCalledWith('review-42', 'src/main.ts', 18, 'RIGHT', 'Needs a guard')
    cleanup()
  })

  it('clears both the active draft and its persisted value', () => {
    const clearInlineDraft = vi.fn()
    const { state, cleanup } = createDraftState({ inlineDraftScopeId: 'review-42', clearInlineDraft })
    state.setText('src/main.ts', 18, SplitSide.new, 'Needs a guard')

    state.clear('src/main.ts', 18, SplitSide.new)

    expect(state.getText('src/main.ts', 18, SplitSide.new)).toBe('')
    expect(clearInlineDraft).toHaveBeenCalledWith('review-42', 'src/main.ts', 18, 'RIGHT')
    cleanup()
  })

  it('submits a trimmed draft into internal pending comments and closes the form', () => {
    const clearInlineDraft = vi.fn()
    const onClose = vi.fn()
    const { state, cleanup } = createDraftState({ inlineDraftScopeId: 'review-42', clearInlineDraft })
    state.setText('src/main.ts', 23, SplitSide.new, '  Explain this branch  ')

    state.submit('src/main.ts', 23, SplitSide.new, onClose)

    expect(state.pendingComments).toEqual([{
      path: 'src/main.ts',
      line: 23,
      side: 'RIGHT',
      body: 'Explain this branch',
    }])
    expect(state.getText('src/main.ts', 23, SplitSide.new)).toBe('')
    expect(clearInlineDraft).toHaveBeenCalledWith('review-42', 'src/main.ts', 23, 'RIGHT')
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()
  })

  it('submits through the controlled pending-comments callback', () => {
    const pendingComments: ReviewSubmissionComment[] = [{
      path: 'src/existing.ts',
      line: 4,
      side: 'LEFT',
      body: 'Existing comment',
    }]
    const onPendingCommentsChange = vi.fn()
    const { state, cleanup } = createDraftState({ pendingComments, onPendingCommentsChange })
    state.setText('src/main.ts', 8, SplitSide.old, 'New comment')

    state.submit('src/main.ts', 8, SplitSide.old, vi.fn())

    expect(onPendingCommentsChange).toHaveBeenCalledWith([
      pendingComments[0],
      { path: 'src/main.ts', line: 8, side: 'LEFT', body: 'New comment' },
    ])
    cleanup()
  })

  it('ignores whitespace-only submissions', () => {
    const onPendingCommentsChange = vi.fn()
    const onClose = vi.fn()
    const { state, cleanup } = createDraftState({ onPendingCommentsChange })
    state.setText('src/main.ts', 8, SplitSide.new, '   ')

    state.submit('src/main.ts', 8, SplitSide.new, onClose)

    expect(onPendingCommentsChange).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    cleanup()
  })

  it('replaces pending comments and counts them by file', () => {
    const comments: ReviewSubmissionComment[] = [
      { path: 'src/main.ts', line: 1, side: 'RIGHT', body: 'One' },
      { path: 'src/main.ts', line: 2, side: 'RIGHT', body: 'Two' },
      { path: 'src/other.ts', line: 3, side: 'LEFT', body: 'Three' },
    ]
    const { state, cleanup } = createDraftState()

    state.setPendingComments(comments)

    expect(state.pendingComments).toEqual(comments)
    expect(state.pendingCommentCountByFile).toEqual(new Map([
      ['src/main.ts', 2],
      ['src/other.ts', 1],
    ]))
    cleanup()
  })
})
