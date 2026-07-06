import { isPluginViewKey } from './plugin/types'
import { emitPluginHostEvent } from './plugin/pluginHostEvents'
import { get } from 'svelte/store'
import {
  activeProjectId,
  currentView,
  lastViewedTaskId,
  pendingManualComments,
  prFileDiffs,
  projectViewSnapshots,
  prOverviewComments,
  reviewComments,
  selectedReviewPr,
  selectedTaskId,
} from './stores'
import type { AppView, ReviewPullRequest } from './types'
import { TASK_CLEARING_VIEWS } from './views'

interface NavState {
  currentView: AppView
  selectedTaskId: string | null
  selectedReviewPr: ReviewPullRequest | null
  activeProjectId: string | null
}

const history: NavState[] = []
const MAX_HISTORY = 50

function captureState(): NavState {
  return {
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
    selectedReviewPr: get(selectedReviewPr),
    activeProjectId: get(activeProjectId),
  }
}

export function pushNavState(): void {
  history.push(captureState())
  if (history.length > MAX_HISTORY) {
    history.shift()
  }
}

export function resetToBoard(): void {
  const previousTaskId = get(selectedTaskId)
  history.length = 0
  currentView.set('board')
  selectedTaskId.set(null)
  selectedReviewPr.set(null)
  if (previousTaskId) {
    lastViewedTaskId.set(previousTaskId)
  }
}

// Snapshot a project's current in-project location (tab + open task/PR) so that
// returning to it can restore where the user was. Reads the live view stores, so it
// must run while `projectId` is still the active project — before a switch rewrites
// them. Called automatically by the activeProjectId subscriber below, which covers
// every switch path (sidebar, switcher, ⌘-cycle, command palette, plugin host).
export function captureProjectView(projectId: string): void {
  projectViewSnapshots.update((snapshots) => {
    const next = new Map(snapshots)
    next.set(projectId, {
      currentView: get(currentView),
      selectedTaskId: get(selectedTaskId),
      selectedReviewPr: get(selectedReviewPr),
    })
    return next
  })
}

// Restore a project's remembered tab + open PR (falling back to the board, with no
// PR, when the project has no snapshot) and reset the back-history. The remembered
// task is NOT applied here: it is returned so the caller can re-apply it once that
// project's tasks have loaded. Applying it now would race the board's "clear unknown
// selected task" effect, which drops any selectedTaskId not present in the (still
// stale) tasks store mid-switch.
export function restoreProjectView(projectId: string): string | null {
  const snapshot = get(projectViewSnapshots).get(projectId)
  history.length = 0
  selectedTaskId.set(null)
  currentView.set(snapshot?.currentView ?? 'board')
  selectedReviewPr.set(snapshot?.selectedReviewPr ?? null)
  return snapshot?.selectedTaskId ?? null
}

// Capture the outgoing project's location on every active-project change so any
// switch path preserves where the user was, regardless of who triggered it. Mirrors
// the backlogLabelFilters subscriber in stores.ts. The switch code always sets
// activeProjectId before rewriting the view stores, so at this point they still
// reflect the project being left.
let previousSnapshotProjectId: string | null = null
activeProjectId.subscribe((projectId) => {
  if (previousSnapshotProjectId && previousSnapshotProjectId !== projectId) {
    captureProjectView(previousSnapshotProjectId)
  }
  previousSnapshotProjectId = projectId
})

function navigateBack(): boolean {
  const prev = history.pop()
  if (!prev) {
    return false
  }

  const hadReviewPr = get(selectedReviewPr)
  const previousTaskId = get(selectedTaskId)

  // Change the project first: the projectViewSnapshots subscriber captures the
  // outgoing project when activeProjectId changes, and it must read the view stores
  // while they still reflect the project being left — before the lines below restore
  // the previous nav state. (Final store values are unaffected by this ordering.)
  activeProjectId.set(prev.activeProjectId)
  currentView.set(prev.currentView)
  selectedTaskId.set(prev.selectedTaskId)
  selectedReviewPr.set(prev.selectedReviewPr)

  if (hadReviewPr && !prev.selectedReviewPr) {
    prFileDiffs.set([])
    reviewComments.set([])
    pendingManualComments.set([])
    prOverviewComments.set([])
  }

  // Returning to the board from a task detail view — flag that task for a one-shot pop.
  if (previousTaskId && prev.selectedTaskId === null) {
    lastViewedTaskId.set(previousTaskId)
  }

  return true
}

export function useAppRouter() {
  let currentViewState = $state<AppView>(get(currentView))

  function navigate(view: AppView) {
    if (view === 'board') {
      resetToBoardRoute()
      currentViewState = 'board'
      notifyViewInvoked(view)
      return
    }

    pushNavState()
    currentViewState = view
    currentView.set(view)

    if (TASK_CLEARING_VIEWS.has(view) || isPluginViewKey(view)) {
      selectedTaskId.set(null)
    }

    notifyViewInvoked(view)
  }

  function notifyViewInvoked(view: AppView) {
    emitPluginHostEvent('view-invoked', { view })
  }

  function navigateToTask(taskId: string) {
    pushNavState()
    // A task detail only renders on the board view, so navigating to a task from
    // any other view (settings, a plugin view, PR review) must return to the board
    // or the detail silently won't show. Push happens first so Back restores the
    // originating view.
    currentView.set('board')
    currentViewState = 'board'
    selectedTaskId.set(taskId)
  }

  function back(): boolean {
    const didNavigate = navigateBack()
    currentViewState = get(currentView)
    return didNavigate
  }

  function resetToBoardRoute() {
    resetToBoard()
    currentViewState = 'board'
  }

  return {
    navigate,
    navigateToTask,
    back,
    resetToBoard: resetToBoardRoute,
    get currentView() {
      return currentViewState
    },
  }
}
