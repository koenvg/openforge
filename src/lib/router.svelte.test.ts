import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { activeProjectId, currentView, lastViewedTaskId, projectViewSnapshots, selectedReviewPr, selectedTaskId } from './stores'
import { captureProjectView, pushNavState, resetToBoard, restoreProjectView, useAppRouter } from './router.svelte'
import { subscribeToPluginHostEvent } from './plugin/pluginHostEvents'
import type { ReviewPullRequest } from './types'

const samplePr = { id: 'pr-1', number: 1 } as unknown as ReviewPullRequest
const PR_REVIEW_VIEW = 'plugin:com.openforge.github-sync:pr_review'

describe('useAppRouter', () => {
  beforeEach(() => {
    const router = useAppRouter()
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)

    while (router.back()) {
    }

    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
  })

  it('navigate(plugin PR review view) clears selectedTaskId synchronously', () => {
    const router = useAppRouter()
    selectedTaskId.set('task-1')

    router.navigate('plugin:com.openforge.github-sync:pr_review')

    expect(get(selectedTaskId)).toBeNull()
    expect(get(currentView)).toBe('plugin:com.openforge.github-sync:pr_review')
  })

  it('navigate emits a view-invoked host event carrying the target view', () => {
    const router = useAppRouter()
    const invoked: unknown[] = []
    const unsubscribe = subscribeToPluginHostEvent('test-plugin', 'view-invoked', (payload) => invoked.push(payload))

    router.navigate(PR_REVIEW_VIEW)
    unsubscribe()

    expect(invoked).toContainEqual({ view: PR_REVIEW_VIEW })
  })

  it('navigate re-emits view-invoked even when navigating to the already-active view', () => {
    const router = useAppRouter()
    currentView.set(PR_REVIEW_VIEW)
    const invoked: unknown[] = []
    const unsubscribe = subscribeToPluginHostEvent('test-plugin', 'view-invoked', (payload) => invoked.push(payload))

    router.navigate(PR_REVIEW_VIEW)
    unsubscribe()

    expect(invoked).toEqual([{ view: PR_REVIEW_VIEW }])
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
    currentView.set('plugin:com.openforge.github-sync:pr_review')

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
    currentView.set('plugin:com.openforge.github-sync:pr_review')

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard resets from plugin skills view', () => {
    currentView.set('plugin:com.openforge.skills-viewer:skills')

    resetToBoard()

    expect(get(currentView)).toBe('board')
  })

  it('resetToBoard clears navigation history', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('board')
    pushNavState()

    currentView.set('settings')
    pushNavState()

    resetToBoard()

    expect(router.back()).toBe(false)
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

describe('useAppRouter lastViewedTaskId', () => {
  beforeEach(() => {
    const router = useAppRouter()
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    activeProjectId.set(null)
    lastViewedTaskId.set(null)

    while (router.back()) {
    }

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
    const router = useAppRouter()
    while (router.back()) {
    }
    currentView.set('board')
    selectedTaskId.set(null)
    selectedReviewPr.set(null)
    // Setting activeProjectId can trigger the auto-capture subscriber; clear the
    // snapshot map afterwards so each test starts from a clean slate.
    activeProjectId.set(null)
    projectViewSnapshots.set(new Map())
  })

  it('captureProjectView snapshots the current tab, task, and PR under the project id', () => {
    currentView.set('plugin:com.openforge.github-sync:pr_review')
    selectedTaskId.set('task-9')
    selectedReviewPr.set(samplePr)

    captureProjectView('proj-X')

    expect(get(projectViewSnapshots).get('proj-X')).toEqual({
      currentView: 'plugin:com.openforge.github-sync:pr_review',
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

  it('restoreProjectView falls back to the board and clears the PR for an unknown project', () => {
    projectViewSnapshots.set(new Map())
    currentView.set('settings')
    selectedReviewPr.set(samplePr)

    const taskId = restoreProjectView('never-visited')

    expect(get(currentView)).toBe('board')
    expect(get(selectedReviewPr)).toBeNull()
    expect(taskId).toBeNull()
  })

  it('restoreProjectView clears the back-navigation history', () => {
    const router = useAppRouter()
    activeProjectId.set('proj-1')
    currentView.set('board')
    pushNavState()
    currentView.set('settings')
    pushNavState()

    restoreProjectView('proj-1')

    expect(router.back()).toBe(false)
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
    currentView.set('plugin:com.openforge.skills-viewer:skills')

    // Switch away — the subscriber captures proj-A — then simulate returning.
    activeProjectId.set('proj-B')
    currentView.set('board')
    activeProjectId.set('proj-A')
    restoreProjectView('proj-A')

    expect(get(currentView)).toBe('plugin:com.openforge.skills-viewer:skills')
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
