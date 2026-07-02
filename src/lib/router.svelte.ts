import { isPluginViewKey } from './plugin/types'
import { get } from 'svelte/store'
import {
  activeProjectId,
  currentView,
  lastViewedTaskId,
  pendingManualComments,
  prFileDiffs,
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

function navigateBack(): boolean {
  const prev = history.pop()
  if (!prev) {
    return false
  }

  const hadReviewPr = get(selectedReviewPr)
  const previousTaskId = get(selectedTaskId)

  currentView.set(prev.currentView)
  selectedTaskId.set(prev.selectedTaskId)
  selectedReviewPr.set(prev.selectedReviewPr)
  activeProjectId.set(prev.activeProjectId)

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
      return
    }

    pushNavState()
    currentViewState = view
    currentView.set(view)

    if (TASK_CLEARING_VIEWS.has(view) || isPluginViewKey(view)) {
      selectedTaskId.set(null)
    }
  }

  function navigateToTask(taskId: string) {
    pushNavState()
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
