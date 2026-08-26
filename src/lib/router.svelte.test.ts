import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { GITHUB_SYNC_VIEW_KEY } from './githubSyncPlugin'
import { TASK_SCHEDULES_VIEW_KEY } from './taskSchedulesPlugin'
import { activeProjectId, currentView, focusBoardFilters, lastViewedTaskId, projects, projectViewSnapshots, selectedReviewPr, selectedTaskId, sidebarPluginViewKeys } from './stores'
import { captureProjectView, pushNavState, resetHistory, resetToBoard, restoreProjectView, selectFocusBoardTab, useAppRouter } from './router.svelte'
import { subscribeToPluginHostEvent } from './plugin/pluginHostEvents'
import type { Project, ReviewPullRequest } from './types'

const samplePr = { id: 'pr-1', number: 1 } as unknown as ReviewPullRequest

describe('useAppRouter', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
  })

  it('navigate(plugin PR review view) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate(GITHUB_SYNC_VIEW_KEY)

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe(GITHUB_SYNC_VIEW_KEY)
  })

  it('navigate emits a view-invoked host event carrying the target view', () => {
    const router = useAppRouter()
    const invoked: unknown[] = []
    const unsubscribe = subscribeToPluginHostEvent('test-plugin', 'view-invoked', (payload) => invoked.push(payload))

    router.navigate(GITHUB_SYNC_VIEW_KEY)
    unsubscribe()

    expect(invoked).toContainEqual({ view: GITHUB_SYNC_VIEW_KEY })
  })

  it('navigate re-emits view-invoked even when navigating to the already-active view', () => {
    const router = useAppRouter()
    currentView.set(GITHUB_SYNC_VIEW_KEY)
    const invoked: unknown[] = []
    const unsubscribe = subscribeToPluginHostEvent('test-plugin', 'view-invoked', (payload) => invoked.push(payload))

    router.navigate(GITHUB_SYNC_VIEW_KEY)
    unsubscribe()

    expect(invoked).toEqual([{ view: GITHUB_SYNC_VIEW_KEY }])
  })

  it('navigate(settings) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('settings')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('settings')
  })

  it('back returns false when history is empty', () => {
    const router = useAppRouter()

    expect(router.back()).toBe(false)
  })

  it('back returns true with history and restores previous state', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('settings')

    expect(get(currentView)).toBe('settings')
    expect(get(selectedTaskId)).toBeNull()

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-1')
  })

  it('resetToBoard does not change activeProjectId', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('settings')
    selectedTaskId.set('task-1')

    router.resetToBoard()

    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('resetToBoard sets currentView to board and clears selectedTaskId', () => {
    currentView.set('settings')
    selectedTaskId.set('task-1')

    resetToBoard()

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('navigateToTask sets selectedTaskId', () => {
    const router = useAppRouter()

    router.navigateToTask('task-42')

    expect(get(selectedTaskId)).toBe('task-42')
  })

  it('navigateToTask returns to the board view so the task detail renders', () => {
    const router = useAppRouter()
    currentView.set('settings')

    router.navigateToTask('task-42')

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-42')
  })

  it('navigateToTask from a plugin view lands on the board', () => {
    const router = useAppRouter()
    currentView.set(GITHUB_SYNC_VIEW_KEY)

    router.navigateToTask('task-7')

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-7')
  })

  it('navigateToTask then back restores the originating non-board view', () => {
    const router = useAppRouter()
    currentView.set('settings')

    router.navigateToTask('task-9')
    expect(get(currentView)).toBe('board')

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('settings')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('pushNavState captures activeProjectId and back restores it', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    pushNavState()

    activeProjectId.set('proj-2')
    currentView.set('settings')

    expect(router.back()).toBe(true)
    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
  })

  it('back restores activeProjectId to different previous values', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-A')
    currentView.set('board')
    pushNavState()

    activeProjectId.set('proj-B')
    currentView.set('global_settings')
    pushNavState()

    activeProjectId.set('proj-C')

    router.back()
    expect(get(activeProjectId)).toBe('proj-B')

    router.back()
    expect(get(activeProjectId)).toBe('proj-A')
  })

  it('back restores null activeProjectId', () => {
    const router = useAppRouter()
    activeProjectId.set(null)
    pushNavState()

    activeProjectId.set('proj-2')

    router.back()
    expect(get(activeProjectId)).toBeNull()
  })

  it('resetToBoard resets from plugin PR review view', () => {
    currentView.set(GITHUB_SYNC_VIEW_KEY)

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard resets from a plugin view', () => {
    currentView.set(TASK_SCHEDULES_VIEW_KEY)

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard pushes an undoable entry instead of clearing history', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('settings')

    resetToBoard()
    expect(get(currentView)).toBe('board')

    // Board is a normal destination now: Back returns to where ⌘H was pressed.
    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('settings')
  })

  it('resetToBoard is a no-op when already on board with no task selected', () => {
    currentView.set('board')
    selectedTaskId.set(null)

    resetToBoard()

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
  })

  it('resetToBoard keeps activeProjectId when already on board', () => {
    activeProjectId.set('proj-1')
    currentView.set('board')

    resetToBoard()

    expect(get(activeProjectId)).toBe('proj-1')
    expect(get(currentView)).toBe('board')
  })
})

describe('selectFocusBoardTab', () => {
  beforeEach(() => {
    focusBoardFilters.set(new Map())
  })

  it('sets the project\'s board filter to focus', () => {
    focusBoardFilters.set(new Map([['proj-1', 'backlog']]))

    selectFocusBoardTab('proj-1')

    expect(get(focusBoardFilters).get('proj-1')).toBe('focus')
  })

  it('does nothing for a null project id', () => {
    selectFocusBoardTab(null)

    expect(get(focusBoardFilters).size).toBe(0)
  })

  it('is a no-op when the project is already on focus', () => {
    const map = new Map([['proj-1', 'focus' as const]])
    focusBoardFilters.set(map)

    selectFocusBoardTab('proj-1')

    // Same Map instance — no reassignment happened.
    expect(get(focusBoardFilters)).toBe(map)
  })
})

describe('navigate(board) re-invocation', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set('proj-1')
    focusBoardFilters.set(new Map())
  })

  it('jumps to Focus when the Board icon is clicked while already on the board', () => {
    const router = useAppRouter()
    focusBoardFilters.set(new Map([['proj-1', 'backlog']]))

    router.navigate('board')

    expect(get(focusBoardFilters).get('proj-1')).toBe('focus')
  })

  it('does not touch the remembered filter when navigating to the board from elsewhere', () => {
    const router = useAppRouter()
    currentView.set('settings')
    focusBoardFilters.set(new Map([['proj-1', 'backlog']]))

    router.navigate('board')

    expect(get(focusBoardFilters).get('proj-1')).toBe('backlog')
  })
})

describe('useAppRouter lastViewedTaskId', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
    lastViewedTaskId.set(null)
  })

  it('resetToBoard records the currently selected task in lastViewedTaskId', () => {
    selectedTaskId.set('task-1')

    resetToBoard()

    expect(get(lastViewedTaskId)).toBe('task-1')
  })

  it('resetToBoard with no selected task does not set lastViewedTaskId', () => {
    selectedTaskId.set(null)

    resetToBoard()

    expect(get(lastViewedTaskId)).toBeNull()
  })

  it('going back to the board from a task records that task in lastViewedTaskId', () => {
    const router = useAppRouter()

    router.navigateToTask('task-1')
    expect(get(selectedTaskId)).toBe('task-1')

    router.back()

    expect(get(selectedTaskId)).toBeNull()
    expect(get(lastViewedTaskId)).toBe('task-1')
  })

  it('going back from task B to task A does not record task B in lastViewedTaskId', () => {
    const router = useAppRouter()

    router.navigateToTask('task-A')
    router.navigateToTask('task-B')

    router.back()

    expect(get(selectedTaskId)).toBe('task-A')
    expect(get(lastViewedTaskId)).not.toBe('task-B')
    expect(get(lastViewedTaskId)).toBeNull()
  })
})

describe('project view memory', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    // Setting activeProjectId can trigger the auto-capture subscriber; clear the
    // snapshot map afterwards so each test starts from a clean slate.
    activeProjectId.set(null)
    projectViewSnapshots.set(new Map())
    sidebarPluginViewKeys.set(new Set())
  })

  it('captureProjectView snapshots the current tab, task, and PR under the project id', () => {
    currentView.set(GITHUB_SYNC_VIEW_KEY)
    selectedTaskId.set('task-9')
    selectedReviewPr.set(samplePr)

    captureProjectView('proj-X')

    expect(get(projectViewSnapshots).get('proj-X')).toEqual({
      currentView: GITHUB_SYNC_VIEW_KEY,
      selectedTaskId: 'task-9',
      selectedReviewPr: samplePr,
    })
  })

  it('restoreProjectView restores the remembered tab and PR and returns the remembered task', () => {
    projectViewSnapshots.set(
      new Map([['proj-A', { currentView: 'settings', selectedTaskId: 'task-1', selectedReviewPr: samplePr }]]),
    )
    currentView.set('board')
    selectedReviewPr.set(null)

    const taskId = restoreProjectView('proj-A')

    expect(get(currentView)).toBe('settings')
    expect(get(selectedReviewPr)).toBe(samplePr)
    expect(taskId).toBe('task-1')
    // The task is not restored synchronously — the caller re-applies it once that
    // project's tasks have loaded, so the "clear unknown task" effect can't drop it.
    expect(get(selectedTaskId)).toBeNull()
  })

  it('restoreProjectView never restores Global Settings as a project view', () => {
    // Global Settings is a cross-project view, not a project location. If it leaked into
    // a project's snapshot (e.g. switching to another project while it was open), it must
    // never be restored — returning to the project falls back to the board. (#1285)
    projectViewSnapshots.set(
      new Map([['proj-A', { currentView: 'global_settings', selectedTaskId: null, selectedReviewPr: null }]]),
    )
    currentView.set('global_settings')
    selectedReviewPr.set(null)

    const taskId = restoreProjectView('proj-A')

    expect(get(currentView)).toBe('board')
    expect(taskId).toBeNull()
  })

  it('restoreProjectView never restores a cross-project sidebar plugin view as a project view', () => {
    // Same class as the global_settings case: switching projects while "All Pull
    // Requests" (a sidebar plugin view) is open can snapshot it as the outgoing project's
    // location. It must not be restored — fall back to the board. (#1285)
    const globalPrKey = 'plugin:com.openforge.github-sync:pr_review_global'
    sidebarPluginViewKeys.set(new Set([globalPrKey]))
    projectViewSnapshots.set(
      new Map([['proj-A', { currentView: globalPrKey, selectedTaskId: null, selectedReviewPr: null }]]),
    )
    currentView.set(globalPrKey)

    const taskId = restoreProjectView('proj-A')

    expect(get(currentView)).toBe('board')
    expect(taskId).toBeNull()
  })

  it('restoreProjectView falls back to the board and clears the PR for an unknown project', () => {
    projectViewSnapshots.set(new Map())
    currentView.set('settings')
    selectedReviewPr.set(samplePr)

    const taskId = restoreProjectView('never-visited')

    expect(get(currentView)).toBe('board')
    expect(get(selectedReviewPr)).toBeNull()
    expect(taskId).toBeNull()
  })

  it('restoreProjectView preserves the back-navigation history', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('board')
    pushNavState()
    currentView.set('settings')
    pushNavState()

    restoreProjectView('proj-1')

    // Switching projects must not wipe history any more — Back can cross back into
    // the project we came from.
    expect(router.back()).toBe(true)
  })

  it('changing activeProjectId captures the outgoing project\'s location', () => {
    activeProjectId.set('proj-A')
    currentView.set('settings')
    selectedTaskId.set('task-1')

    activeProjectId.set('proj-B')

    expect(get(projectViewSnapshots).get('proj-A')).toEqual({
      currentView: 'settings',
      selectedTaskId: 'task-1',
      selectedReviewPr: null,
    })
  })

  it('round-trips: leaving a project on a plugin tab then restoring it returns to that tab', () => {
    activeProjectId.set('proj-A')
    currentView.set(TASK_SCHEDULES_VIEW_KEY)

    // Switch away — the subscriber captures proj-A — then simulate returning.
    activeProjectId.set('proj-B')
    currentView.set('board')
    activeProjectId.set('proj-A')
    restoreProjectView('proj-A')

    expect(get(currentView)).toBe(TASK_SCHEDULES_VIEW_KEY)
  })

  it('cross-project back navigation captures the project being left with its own view', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-A')
    currentView.set('board')
    pushNavState()

    // Move to proj-B on a different tab, then go back to proj-A.
    activeProjectId.set('proj-B')
    currentView.set('settings')
    router.back()

    expect(get(activeProjectId)).toBe('proj-A')
    expect(get(currentView)).toBe('board')
    // proj-B must be snapshotted with the tab it was actually on (settings), not the
    // restored proj-A view — this guards the activeProjectId-first ordering in
    // navigateBack.
    expect(get(projectViewSnapshots).get('proj-B')).toEqual({
      currentView: 'settings',
      selectedTaskId: null,
      selectedReviewPr: null,
    })
  })
})

describe('useAppRouter forward navigation', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
  })

  it('forward returns false when there is nothing ahead', () => {
    const router = useAppRouter()

    expect(router.forward()).toBe(false)
  })

  it('forward re-applies a view undone by back', () => {
    const router = useAppRouter()
    router.navigate('settings')

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')

    expect(router.forward()).toBe(true)
    expect(get(currentView)).toBe('settings')
  })

  it('back then forward round-trips a mixed view/task sequence', () => {
    const router = useAppRouter()
    router.navigate('settings')
    router.navigateToTask('task-1')
    router.navigate('global_settings')

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-1')
    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('settings')
    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')
    expect(router.back()).toBe(false)

    expect(router.forward()).toBe(true)
    expect(get(currentView)).toBe('settings')
    expect(router.forward()).toBe(true)
    expect(get(selectedTaskId)).toBe('task-1')
    expect(router.forward()).toBe(true)
    expect(get(currentView)).toBe('global_settings')
    expect(router.forward()).toBe(false)
  })

  it('navigating to a new view after back truncates the forward trail', () => {
    const router = useAppRouter()
    router.navigate('settings')
    router.back()
    expect(get(currentView)).toBe('board')

    router.navigate('global_settings')

    expect(router.forward()).toBe(false)
  })

  it('consecutive identical pushNavState calls collapse into one history entry', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('settings')
    pushNavState()
    pushNavState()

    expect(router.back()).toBe(true)
    expect(router.back()).toBe(false)
  })

  it('navigating to the already-active view does not add a history entry', () => {
    const router = useAppRouter()
    router.navigate('settings')
    router.navigate('settings')

    expect(router.back()).toBe(true)
    expect(get(currentView)).toBe('board')
    expect(router.back()).toBe(false)
  })

  it('caps the back history at 50 entries, dropping the oldest', () => {
    const router = useAppRouter()
    // Alternate two views so consecutive states never dedup.
    for (let i = 0; i < 60; i++) {
      router.navigate(i % 2 === 0 ? 'settings' : 'global_settings')
    }

    let count = 0
    while (router.back()) count++

    expect(count).toBe(50)
  })
})

describe('useAppRouter cross-project history', () => {
  beforeEach(() => {
    resetHistory()
    projects.set([])
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
    projectViewSnapshots.set(new Map())
  })

  it('back restores a task detail from another project synchronously', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-B')
    currentView.set('board')
    selectedTaskId.set('task-B1')
    pushNavState()

    activeProjectId.set('proj-A')
    currentView.set('settings')
    selectedTaskId.set(null)

    expect(router.back()).toBe(true)
    expect(get(activeProjectId)).toBe('proj-B')
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('task-B1')
  })

  it('back skips history entries for a project that no longer exists', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-live')
    currentView.set('settings')
    pushNavState()
    activeProjectId.set('proj-gone')
    currentView.set('global_settings')
    pushNavState()

    projects.set([{ id: 'proj-live' } as unknown as Project])
    activeProjectId.set('proj-live')
    currentView.set('board')

    expect(router.back()).toBe(true)
    expect(get(activeProjectId)).toBe('proj-live')
    expect(get(currentView)).toBe('settings')
  })

  it('back returns false when every history entry is for a deleted project', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-gone')
    currentView.set('settings')
    pushNavState()

    projects.set([{ id: 'proj-live' } as unknown as Project])
    activeProjectId.set('proj-live')
    currentView.set('board')

    expect(router.back()).toBe(false)
  })
})
