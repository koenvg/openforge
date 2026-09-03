import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ReviewPullRequest, TaskAttentionRow, TaskLaneRows } from '../../lib/types'
import type { AttentionTaskReference } from '../../lib/attentionOverview'
import {
  projects,
  reviewPrs,
  ticketPrs,
  hiddenProjectIds,
  globalExcludedPrRepos,
  activeProjectId,
  taskAttentionRows,
} from '../../lib/stores'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import AttentionOverviewDialog from './AttentionOverviewDialog.svelte'

// The dialog reads the backend-owned task projection over IPC; the stores it subscribes
// to are the real Svelte writables, driven directly here to simulate agent/PR activity.
const ipc = vi.hoisted(() => ({
  getAllTasks: vi.fn(),
  getTaskLanes: vi.fn(),
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ipc)

const REFRESH_DEBOUNCE_MS = 250

function laneRows(overrides: Partial<TaskLaneRows> = {}): TaskLaneRows {
  return { focus: [], in_flight: [], out_of_focus: [], backlog: [], ...overrides }
}

function projectRecord(id: string, name: string): Project {
  return { id, name, path: `/repos/${id}`, created_at: 0, updated_at: 0 }
}

function taskRecord(id: string, projectId: string, _title: string): AttentionTaskReference {
  return { id, projectId }
}

function mockTaskSnapshots(_tasks: AttentionTaskReference[]): void {
  // Task identity now comes from the narrow lane projection returned by getTaskLanes.
}

function attentionRow(
  taskId: string,
  projectId: string,
  title: string,
  overrides: Partial<TaskAttentionRow> = {},
): TaskAttentionRow {
  return {
    task_id: taskId,
    project_id: projectId,
    project_name: projectId,
    title,
    state: 'idle',
    reason: 'No agent running. Start when ready.',
    activity_at: 0,
    has_unread_agent_output: false,
    ...overrides,
  }
}

function reviewPr(id: number, owner: string, name: string, title: string): ReviewPullRequest {
  return {
    id,
    number: id,
    title,
    body: null,
    state: 'open',
    draft: false,
    html_url: `https://github.com/${owner}/${name}/pull/${id}`,
    user_login: 'octocat',
    user_avatar_url: null,
    repo_owner: owner,
    repo_name: name,
    head_ref: 'feature',
    base_ref: 'main',
    head_sha: 'sha',
    additions: 1,
    deletions: 0,
    changed_files: 1,
    mergeable: null,
    mergeable_state: null,
    created_at: id,
    updated_at: id,
    viewed_at: null,
    viewed_head_sha: null,
    labels: [],
  }
}

type DialogProps = {
  onClose: () => void
  onOpenTask: (task: AttentionTaskReference) => void
  onOpenPr: (pr: ReviewPullRequest, projectId: string | null) => void
}

function renderDialog(props: Partial<DialogProps> = {}) {
  return render(AttentionOverviewDialog, {
    props: { onClose: vi.fn(), onOpenTask: vi.fn(), onOpenPr: vi.fn(), ...props },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('AttentionOverviewDialog — live refresh while open', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    projects.set([])
    reviewPrs.set([])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    taskAttentionRows.set([])

    mockTaskSnapshots([])
    ipc.getTaskLanes.mockResolvedValue(laneRows())
    ipc.getProjectConfig.mockResolvedValue(null)
    ipc.getConfig.mockResolvedValue(null)
    ipc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('adds a newly arrived review request without a close/reopen', async () => {
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    // A new review-requested PR arrives while the dialog stays open.
    reviewPrs.set([reviewPr(1, 'someone', 'unknown', 'Please review my fix')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    await vi.waitFor(() => expect(screen.getByText('Please review my fix')).toBeTruthy())
  })

  it('surfaces a task that becomes idle after an agent finishes (cross-project heartbeat)', async () => {
    projects.set([projectRecord('p1', 'Project One')])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    // Agent finished: the task is now an idle "doing" task that needs the user.
    mockTaskSnapshots([taskRecord('t1', 'p1', '')])
    ipc.getTaskLanes.mockResolvedValue(laneRows({ focus: [attentionRow('t1', 'p1', 'Investigate flaky test')] }))
    // The orchestrator recomputes attentionCountByProject on the agent-finished event.
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Investigate flaky test')])
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Task One')])

    await vi.waitFor(() => expect(screen.getByText('Investigate flaky test')).toBeTruthy())
    expect(screen.getByText(/No agent running\. Start when ready\./)).toBeTruthy()
    expect(ipc.getTaskLanes).toHaveBeenCalled()
    expect(ipc.getAllTasks).not.toHaveBeenCalled()
  })

  it('updates Focus and In Flight counts when unread output is acknowledged', async () => {
    projects.set([projectRecord('p1', 'Project One')])
    const unread = attentionRow('t1', 'p1', 'Unread reply', {
      state: 'review-pending',
      reason: 'Waiting on code review.',
      has_unread_agent_output: true,
    })
    ipc.getTaskLanes.mockResolvedValue(laneRows({ focus: [unread] }))
    taskAttentionRows.set([unread])
    renderDialog()

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^T Focus 1$/i })).toBeTruthy()
      expect(screen.getByText('Unread agent output')).toBeTruthy()
    })
    const dialog = screen.getByRole('dialog')

    ipc.getTaskLanes.mockResolvedValue(laneRows({
      in_flight: [attentionRow('t1', 'p1', 'Unread reply', {
        state: 'review-pending',
        reason: 'Waiting on code review.',
      })],
    }))
    taskAttentionRows.set([])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^T Focus 0$/i })).toBeTruthy()
      expect(screen.queryByText('Unread reply')).toBeNull()
    })
    await fireEvent.keyDown(dialog, { key: 't' })
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByRole('button', { name: /^T In Flight 1$/i })).toBeTruthy()
    expect(screen.getByText('Unread reply')).toBeTruthy()
    expect(screen.queryByText('Unread agent output')).toBeNull()
  })


  it('keeps the newest Task attention snapshot when refreshes finish out of order', async () => {
    projects.set([projectRecord('p1', 'Project One')])
    mockTaskSnapshots([
      taskRecord('older', 'p1', 'Older result'),
      taskRecord('newer', 'p1', 'Newer result'),
    ])
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText(/all caught up/i)).toBeTruthy())

    const older = deferred<TaskLaneRows>()
    const newer = deferred<TaskLaneRows>()
    ipc.getTaskLanes
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    taskAttentionRows.set([attentionRow('older', 'p1', 'Older result')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    taskAttentionRows.set([attentionRow('newer', 'p1', 'Newer result')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    newer.resolve(laneRows({ focus: [attentionRow('newer', 'p1', 'Newer result')] }))
    await vi.waitFor(() => expect(screen.getByText('Newer result')).toBeTruthy())
    older.resolve(laneRows({ focus: [attentionRow('older', 'p1', 'Older result')] }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Newer result')).toBeTruthy()
    expect(screen.queryByText('Older result')).toBeNull()
  })

  it('preserves the collapsed-project state across a refresh (does not re-read config)', async () => {
    projects.set([projectRecord('p1', 'Project One'), projectRecord('p2', 'Project Two')])
    mockTaskSnapshots([
      taskRecord('t1', 'p1', 'Task One'),
      taskRecord('t2', 'p2', 'Task Two'),
    ])
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Task One'), attentionRow('t2', 'p2', 'Task Two')],
    }))
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())

    // Collapse Project One. getConfig still returns null, so a config re-read on refresh
    // would wrongly expand it again — this guards that refresh keeps in-memory collapse.
    await fireEvent.click(screen.getByText('Project One'))
    await vi.waitFor(() => expect(screen.queryByText('Task One')).toBeNull())

    // A refresh fires (e.g. an agent elsewhere finished).
    taskAttentionRows.set([attentionRow('t1', 'p1', 'Task One')])
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)

    expect(screen.queryByText('Task One')).toBeNull() // still collapsed
    expect(screen.getByText('Task Two')).toBeTruthy() // sibling still expanded
  })
})

describe('AttentionOverviewDialog — initial focus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    projects.set([projectRecord('p1', 'Project One')])
    reviewPrs.set([])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    taskAttentionRows.set([])

    mockTaskSnapshots([taskRecord('t1', 'p1', 'Task One'), taskRecord('t2', 'p1', 'Task Two')])
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Task One'), attentionRow('t2', 'p1', 'Task Two')],
    }))
    ipc.getProjectConfig.mockResolvedValue(null)
    ipc.getConfig.mockResolvedValue(null)
    ipc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('hands DOM focus to the highlighted row once the list renders', async () => {
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())

    // Row 0 is the project header, which ↑/↓ skip while expanded, so the cursor opens on row 1.
    expect(document.activeElement?.getAttribute('data-attn-row')).toBe('1')
  })

  it('keeps the shortcuts alive after a filter empties the list', async () => {
    // Reviews only: hiding them removes every row, including the one holding DOM focus.
    mockTaskSnapshots([])
    ipc.getTaskLanes.mockResolvedValue(laneRows())
    reviewPrs.set([reviewPr(1, 'someone', 'unknown', 'Please review my fix')])

    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Please review my fix')).toBeTruthy())

    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'r' })
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/Reviews are hidden/i)).toBeTruthy()

    // R again, from wherever focus landed, has to bring them back without a mouse click first.
    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'r' })
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Please review my fix')).toBeTruthy()
    expect(document.activeElement?.getAttribute('data-attn-row')).toBe('1')
  })

  it('opens the highlighted row on Enter without moving the cursor first', async () => {
    const onOpenTask = vi.fn()
    renderDialog({ onOpenTask })
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())

    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledTimes(1)
    expect(onOpenTask.mock.calls[0][0].id).toBe('t1')
  })
})

describe('AttentionOverviewDialog — T / R toggles', () => {
  // Noon, so the in-flight ages below are exact rather than clock-dependent.
  const NOW_SECONDS = Math.floor(Date.parse('2026-08-26T12:00:00Z') / 1000)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_SECONDS * 1000)
    projects.set([projectRecord('p1', 'Project One'), projectRecord('p2', 'Project Two')])
    reviewPrs.set([reviewPr(1, 'someone', 'unknown', 'Please review my fix')])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    taskAttentionRows.set([])

    mockTaskSnapshots([
      taskRecord('t1', 'p1', 'Focus task'),
      taskRecord('t2', 'p1', 'Parked one'),
      taskRecord('t3', 'p2', 'Parked two'),
      taskRecord('t4', 'p1', 'Flying task'),
      taskRecord('t5', 'p2', 'Queued task'),
    ])
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Focus task')],
      in_flight: [
        attentionRow('t4', 'p1', 'Flying task', {
          state: 'active',
          reason: 'Agent is running — no action needed right now.',
          activity_at: NOW_SECONDS - 2 * 3600,
        }),
      ],
      out_of_focus: [
        attentionRow('t2', 'p1', 'Parked one'),
        // Parked, but its agent is still running: the lane is a manual choice, so this one
        // counts toward the running total while never appearing in the focus lane.
        attentionRow('t3', 'p2', 'Parked two', { state: 'active' }),
      ],
      backlog: [attentionRow('t5', 'p2', 'Queued task', { state: 'backlog' })],
    }))
    ipc.getProjectConfig.mockResolvedValue(null)
    ipc.getConfig.mockResolvedValue(null)
    ipc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function renderLoaded() {
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Focus task')).toBeTruthy())
    return screen.getByRole('dialog')
  }

  async function press(dialog: HTMLElement, key: string) {
    await fireEvent.keyDown(dialog, { key })
    await vi.advanceTimersByTimeAsync(0)
  }

  it('R hides every review row and leaves tasks alone, then restores them', async () => {
    const dialog = await renderLoaded()

    await press(dialog, 'r')
    expect(screen.queryByText('Please review my fix')).toBeNull()
    expect(screen.getByText('Focus task')).toBeTruthy()

    await press(dialog, 'r')
    expect(screen.getByText('Please review my fix')).toBeTruthy()
  })

  it('T walks the four board lanes and wraps back to focus', async () => {
    const dialog = await renderLoaded()
    // Only one lane is on screen at a time, so each step swaps the whole list.
    const visible = () => ['Focus task', 'Flying task', 'Parked one', 'Queued task']
      .filter((title) => screen.queryByText(title) !== null)

    expect(visible()).toEqual(['Focus task'])

    await press(dialog, 't')
    expect(visible()).toEqual(['Flying task'])

    await press(dialog, 't')
    expect(visible()).toEqual(['Parked one'])
    // The set-aside lane is the only place to see every parked task at once.
    expect(screen.getByText('Parked two')).toBeTruthy()
    expect(screen.getByText('Project Two')).toBeTruthy()

    await press(dialog, 't')
    expect(visible()).toEqual(['Queued task'])

    await press(dialog, 't')
    expect(visible()).toEqual(['Focus task'])
  })


  it('shows unread Agent output in both Focus and Out of Focus without replacing the reason', async () => {
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Focus task', {
        state: 'review-pending',
        reason: 'Waiting on code review.',
        has_unread_agent_output: true,
      })],
      out_of_focus: [attentionRow('t2', 'p1', 'Parked one', {
        has_unread_agent_output: true,
      })],
    }))
    const dialog = await renderLoaded()

    expect(screen.getByText('Unread agent output')).toBeTruthy()
    expect(screen.getByText(/Review Pending · Waiting on code review\./)).toBeTruthy()

    await press(dialog, 't')
    await press(dialog, 't')

    expect(screen.getByText('Parked one')).toBeTruthy()
    expect(screen.getByText('Unread agent output')).toBeTruthy()
    expect(screen.getByText(/No agent running\. Start when ready\./)).toBeTruthy()
  })
  it('ages the in-flight rows off their last state change, and only those rows', async () => {
    const dialog = await renderLoaded()

    await press(dialog, 't')

    // The agent started two hours ago and has not changed state since.
    expect(screen.getByText('2h')).toBeTruthy()

    // Every other lane sits still by definition, so an age there would be noise.
    await press(dialog, 't')
    expect(screen.queryByText('2h')).toBeNull()
  })

  it('accepts the shortcuts uppercase and ignores them when a modifier is held', async () => {
    const dialog = await renderLoaded()

    await fireEvent.keyDown(dialog, { key: 'T', shiftKey: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText('Flying task')).toBeTruthy()

    // ⌘R is the app/browser reload, never a filter toggle.
    await fireEvent.keyDown(dialog, { key: 'r', metaKey: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText('Please review my fix')).toBeTruthy()
  })

  it('persists the review toggle, but reopens on the focus lane', async () => {
    const dialog = await renderLoaded()

    await press(dialog, 'r')
    await press(dialog, 't')

    expect(ipc.setConfig).toHaveBeenCalledWith(
      'attention_overview_filters',
      JSON.stringify({ showReviews: false }),
    )
    expect(ipc.setConfig.mock.calls.every(([key]) => key !== 'attention_overview_lane')).toBe(true)
  })

  it('restores the persisted review toggle when the dialog reopens', async () => {
    ipc.getConfig.mockImplementation(async (key: string) =>
      key === 'attention_overview_filters' ? JSON.stringify({ showReviews: false }) : null)

    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Focus task')).toBeTruthy())

    expect(screen.queryByText('Please review my fix')).toBeNull()
  })

  it('keeps the running-agent count on screen in every lane and with reviews hidden', async () => {
    const dialog = await renderLoaded()

    // One running agent is in flight (t4) and one is parked (t6), so the header counts both
    // even though neither is ever visible in the focus lane the dialog opens on.
    expect(screen.getByText('2 agents running')).toBeTruthy()

    for (const lane of ['In Flight', 'Out of Focus', 'Backlog', 'Focus']) {
      await press(dialog, 't')
      expect(screen.getByRole('button', { name: new RegExp(`^T ${lane} `) })).toBeTruthy()
      expect(screen.getByText('2 agents running')).toBeTruthy()
    }

    await press(dialog, 'r')
    expect(screen.getByText('2 agents running')).toBeTruthy()
  })

  it('says no agents are running rather than showing a bare zero', async () => {
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Focus task')],
    }))
    await renderLoaded()

    expect(screen.getByText('No agents running')).toBeTruthy()
  })

  it('counts one running agent in the singular', async () => {
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Focus task')],
      in_flight: [attentionRow('t4', 'p1', 'Flying task', { state: 'active' })],
    }))
    await renderLoaded()

    expect(screen.getByText('1 agent running')).toBeTruthy()
  })

  it('shows exactly two chips: the current lane and the review toggle', async () => {
    const dialog = await renderLoaded()
    const chips = () => screen.getAllByRole('button')
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
      .filter((text) => /^[TR] /.test(text ?? ''))

    // T names the one lane on screen and carries its count. There is no separate "Tasks"
    // chip, so the header never reads as four lists running side by side.
    expect(chips()).toEqual(['T Focus 1', 'R Reviews 1'])

    await press(dialog, 't')
    expect(chips()).toEqual(['T In Flight 1', 'R Reviews 1'])

    await press(dialog, 't')
    expect(chips()).toEqual(['T Out of Focus 2', 'R Reviews 1'])

    await press(dialog, 't')
    expect(chips()).toEqual(['T Backlog 1', 'R Reviews 1'])
  })

  it('cycles from the header chip as well as the keyboard', async () => {
    await renderLoaded()

    await fireEvent.click(screen.getByRole('button', { name: /^T Focus 1$/ }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Flying task')).toBeTruthy()
    expect(screen.queryByText('Focus task')).toBeNull()
    // A four-lane cycler is not a toggle, so the chip states its lane instead of a pressed bit.
    const laneChip = screen.getByRole('button', { name: /^T In Flight 1$/ })
    expect(laneChip.hasAttribute('aria-pressed')).toBe(false)
    expect(screen.getByRole('button', { name: /^R Reviews 1$/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('explains an empty list caused by hidden reviews instead of claiming you are caught up', async () => {
    // Reviews only, so hiding them clears the list.
    ipc.getTaskLanes.mockResolvedValue(laneRows())
    renderDialog()
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Please review my fix')).toBeTruthy())

    await press(screen.getByRole('dialog'), 'r')

    expect(screen.queryByText(/all caught up/i)).toBeNull()
    expect(screen.getByText(/Reviews are hidden/i)).toBeTruthy()
  })

  it('names the empty lane instead of claiming you are caught up', async () => {
    reviewPrs.set([])
    ipc.getTaskLanes.mockResolvedValue(laneRows({
      focus: [attentionRow('t1', 'p1', 'Focus task')],
    }))
    const dialog = await renderLoaded()

    await press(dialog, 't')
    expect(screen.getByText(/Nothing is in flight/i)).toBeTruthy()
    expect(screen.queryByText(/all caught up/i)).toBeNull()

    await press(dialog, 't')
    expect(screen.getByText(/Nothing is set aside/i)).toBeTruthy()

    await press(dialog, 't')
    expect(screen.getByText(/The backlog is empty/i)).toBeTruthy()
  })
})

describe('AttentionOverviewDialog — plugin review row actions', () => {
  const PLUGIN_ID = 'plugin.github-sync'

  function registerRowActionPlugin(actions: { id: string; order: number }[]): void {
    installedPlugins.set(new Map([[
      PLUGIN_ID,
      {
        manifest: {
          id: PLUGIN_ID,
          name: 'GitHub Sync',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Review row action test plugin',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'active',
        error: null,
      },
    ]]) as never)
    enabledPluginIds.set(new Set([PLUGIN_ID]))
    runtimeContributionSources.set(new Map([[PLUGIN_ID, { pluginId: PLUGIN_ID, reviewRowActions: actions }]]))
    for (const action of actions) {
      registerRenderableContributionComponent('reviewRowActions', `${PLUGIN_ID}:${action.id}`, PluginSlotTestView as never)
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    projects.set([projectRecord('p1', 'Project One')])
    reviewPrs.set([reviewPr(1, 'someone', 'app', 'Please review my fix')])
    ticketPrs.set(new Map())
    hiddenProjectIds.set(new Set())
    globalExcludedPrRepos.set(new Set())
    activeProjectId.set(null)
    taskAttentionRows.set([])
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()

    mockTaskSnapshots([])
    ipc.getTaskLanes.mockResolvedValue(laneRows())
    ipc.getProjectConfig.mockResolvedValue(null)
    ipc.getConfig.mockResolvedValue(null)
    ipc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    clearComponentRegistry()
  })

  async function renderWithReview(props: Partial<DialogProps> = {}) {
    renderDialog(props)
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.waitFor(() => expect(screen.getByText('Please review my fix')).toBeTruthy())
  }

  it("renders a contributed control on the review row, carrying that row's pull request", async () => {
    registerRowActionPlugin([{ id: 'pr_walkthrough', order: 10 }])
    reviewPrs.set([
      reviewPr(1, 'someone', 'app', 'Please review my fix'),
      reviewPr(2, 'someone', 'app', 'And this one too'),
    ])

    await renderWithReview()

    await vi.waitFor(() => expect(screen.getAllByTestId('plugin-slot-view')).toHaveLength(2))
    // Each row gets its own instance, holding the pull request that row is showing.
    expect(screen.getAllByTestId('plugin-slot-view').map((el) => el.getAttribute('data-pr-number')))
      .toEqual(['2', '1'])
  })

  it('keeps a click on the contributed control from opening the pull request behind it', async () => {
    registerRowActionPlugin([{ id: 'pr_walkthrough', order: 10 }])
    const onOpenPr = vi.fn()
    await renderWithReview({ onOpenPr })
    await vi.waitFor(() => expect(screen.getByTestId('plugin-slot-view')).toBeTruthy())

    await fireEvent.click(screen.getByTestId('plugin-slot-view'))
    await vi.advanceTimersByTimeAsync(0)

    expect(onOpenPr).not.toHaveBeenCalled()
  })

  it('swallows Enter on the contributed control, but still lets the lane shortcut through', async () => {
    registerRowActionPlugin([{ id: 'pr_walkthrough', order: 10 }])
    const onOpenPr = vi.fn()
    await renderWithReview({ onOpenPr })
    await vi.waitFor(() => expect(screen.getByTestId('plugin-slot-view')).toBeTruthy())
    const control = screen.getByTestId('plugin-slot-view')

    // A keyboard that tabbed onto the control must not open the pull request behind it.
    await fireEvent.keyDown(control, { key: 'Enter', bubbles: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(onOpenPr).not.toHaveBeenCalled()

    // Navigation still reaches the dialog from inside the control.
    await fireEvent.keyDown(control, { key: 't', bubbles: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByRole('button', { name: /^T In Flight 0$/ })).toBeTruthy()
  })

  it('renders nothing extra on the row when no plugin contributes', async () => {
    await renderWithReview()

    expect(screen.queryByTestId('plugin-slot-view')).toBeNull()
    // No empty wrapper either: a stray element would show as a gap in the row.
    expect(document.querySelector('[data-slot-type="reviewRowActions"]')).toBeNull()
  })
})
