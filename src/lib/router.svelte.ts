import { isPluginViewKey } from './plugin/types'
import { emitPluginHostEvent } from './plugin/pluginHostEvents'
import { get } from 'svelte/store'
import {
  activeProjectId,
  currentView,
  lastViewedTaskId,
  pendingManualComments,
  prFileDiffs,
  projects,
  projectViewSnapshots,
  prOverviewComments,
  reviewComments,
  selectedReviewPr,
  selectedTaskId,
  sidebarPluginViewKeys,
} from './stores'
import type { AppView, ReviewPullRequest } from './types'
import { isCrossProjectView, TASK_CLEARING_VIEWS } from './views'

interface NavState {
  currentView: AppView
  selectedTaskId: string | null
  selectedReviewPr: ReviewPullRequest | null
  activeProjectId: string | null
}

// Browser-style back/forward: `backStack` holds locations departed from (oldest →
// newest), `forwardStack` holds locations undone by Back. A fresh navigation drops the
// forward trail. History spans every screen AND every project, so Ctrl+Tab / Ctrl+Shift+Tab
// walk anywhere the user has been.
const backStack: NavState[] = []
const forwardStack: NavState[] = []
const MAX_HISTORY = 50

function captureState(): NavState {
  return {
    currentView: get(currentView),
    selectedTaskId: get(selectedTaskId),
    selectedReviewPr: get(selectedReviewPr),
    activeProjectId: get(activeProjectId),
  }
}

function navStatesEqual(a: NavState, b: NavState): boolean {
  return (
    a.currentView === b.currentView &&
    a.selectedTaskId === b.selectedTaskId &&
    a.selectedReviewPr === b.selectedReviewPr &&
    a.activeProjectId === b.activeProjectId
  )
}

// Clear all navigation history. Used for genuine resets (e.g. test isolation); ordinary
// user navigation never clears history — that is the whole point of back/forward.
export function resetHistory(): void {
  backStack.length = 0
  forwardStack.length = 0
}

// Record the current location as a new navigation departure: it becomes reachable via
// Back, and any forward trail is dropped (browser semantics). Consecutive identical
// states collapse so Back is never a dead press.
export function pushNavState(): void {
  const state = captureState()
  forwardStack.length = 0
  const top = backStack[backStack.length - 1]
  if (top && navStatesEqual(top, state)) {
    return
  }
  backStack.push(state)
  if (backStack.length > MAX_HISTORY) {
    backStack.shift()
  }
}

export function resetToBoard(): void {
  // Already on the board with nothing drilled in — there is nothing to navigate to, so
  // don't manufacture a junk history entry.
  if (get(currentView) === 'board' && get(selectedTaskId) === null && get(selectedReviewPr) === null) {
    return
  }
  const previousTaskId = get(selectedTaskId)
  // The board is an ordinary, undoable destination now: record where we came from so
  // Ctrl+Tab (or ⌘[) returns there after ⌘H / clicking Board.
  pushNavState()
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
// PR, when the project has no snapshot). The remembered task is NOT applied here: it is
// returned so the caller can re-apply it once that project's tasks have loaded. Applying
// it now would race the board's "clear unknown selected task" effect, which drops any
// selectedTaskId not present in the (still stale) tasks store mid-switch. The back/forward
// history is deliberately left intact so navigation can cross project boundaries.
export function restoreProjectView(projectId: string): string | null {
  const rawSnapshot = get(projectViewSnapshots).get(projectId)
  // A snapshot whose view is cross-project (Global Settings or a sidebar plugin view) is
  // not a project location — it can leak in when the user switches projects while such a
  // view is open. Ignore it and fall back to the board so returning to the project shows
  // its board rather than a global view (#1285).
  const snapshot = rawSnapshot && isCrossProjectView(rawSnapshot.currentView, get(sidebarPluginViewKeys))
    ? undefined
    : rawSnapshot
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

// A history entry is stale once its project has been deleted (loadProjects reassigns
// activeProjectId directly, without touching history). Treat a null project (cross-project
// views) as always valid, and skip pruning until projects have actually loaded so unit
// tests and startup aren't affected.
function isProjectValid(projectId: string | null): boolean {
  if (projectId === null) {
    return true
  }
  const list = get(projects)
  if (list.length === 0) {
    return true
  }
  return list.some((project) => project.id === projectId)
}

function dropStaleEntries(stack: NavState[]): void {
  while (stack.length > 0 && !isProjectValid(stack[stack.length - 1].activeProjectId)) {
    stack.pop()
  }
}

function applyNavState(target: NavState): void {
  const hadReviewPr = get(selectedReviewPr)
  const previousTaskId = get(selectedTaskId)

  // Change the project first: the projectViewSnapshots subscriber captures the
  // outgoing project when activeProjectId changes, and it must read the view stores
  // while they still reflect the project being left — before the lines below restore
  // the target nav state. (Final store values are unaffected by this ordering.)
  activeProjectId.set(target.activeProjectId)
  currentView.set(target.currentView)
  selectedTaskId.set(target.selectedTaskId)
  selectedReviewPr.set(target.selectedReviewPr)

  if (hadReviewPr && !target.selectedReviewPr) {
    prFileDiffs.set([])
    reviewComments.set([])
    pendingManualComments.set([])
    prOverviewComments.set([])
  }

  // Returning to the board from a task detail view — flag that task for a one-shot pop.
  if (previousTaskId && target.selectedTaskId === null) {
    lastViewedTaskId.set(previousTaskId)
  }
}

function navigateBack(): boolean {
  dropStaleEntries(backStack)
  if (backStack.length === 0) {
    return false
  }
  const current = captureState()
  const prev = backStack.pop()!
  forwardStack.push(current)
  applyNavState(prev)
  return true
}

function navigateForward(): boolean {
  dropStaleEntries(forwardStack)
  if (forwardStack.length === 0) {
    return false
  }
  const current = captureState()
  const next = forwardStack.pop()!
  backStack.push(current)
  applyNavState(next)
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

    // Navigating to the view we're already on isn't a move — don't add a dead history
    // entry, but still re-emit so plugins can react to the (re-)invocation.
    if (get(currentView) !== view) {
      pushNavState()
      currentViewState = view
      currentView.set(view)

      if (TASK_CLEARING_VIEWS.has(view) || isPluginViewKey(view)) {
        selectedTaskId.set(null)
      }
    }

    notifyViewInvoked(view)
  }

  function notifyViewInvoked(view: AppView) {
    emitPluginHostEvent('view-invoked', { view })
  }

  function navigateToTask(taskId: string) {
    // Re-opening the task already showing is a no-op, not a new history entry.
    if (get(selectedTaskId) === taskId && get(currentView) === 'board') {
      return
    }
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

  function forward(): boolean {
    const didNavigate = navigateForward()
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
    forward,
    resetToBoard: resetToBoardRoute,
    get currentView() {
      return currentViewState
    },
  }
}
