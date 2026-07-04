import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
import type { TaskSchedule } from '../lib/types'
import TaskSchedulesView from './TaskSchedulesView.svelte'

const LIST_SCHEDULES_METHOD = 'listSchedules'

const whenReady = vi.fn()
const invoke = vi.fn()

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function makeApi(): FrontendOpenForgeAPI {
  return {
    backend: { whenReady, invoke },
  } as unknown as FrontendOpenForgeAPI
}

const context: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.task-schedules',
  projectId: 'project-1',
}

function makeSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: 'schedule-1',
    title: 'Daily dependency triage',
    prompt: 'Review dependency update tasks and create follow-up work.',
    preset: 'daily',
    cron: '0 9 * * *',
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 2, 9),
    lastFireAt: null,
    lastTaskId: null,
    history: [],
    ...overrides,
  }
}

const enabledSchedule = makeSchedule()
const disabledSchedule = makeSchedule({
  id: 'schedule-2',
  title: 'Dormant cleanup review',
  prompt: 'Check stale cleanup tasks but do not run automatically yet.',
  enabled: false,
  nextFireAt: Date.UTC(2026, 0, 3, 9),
})

function renderTaskSchedulesView(props: { projectId?: string | null; projectName?: string } = {}) {
  return render(TaskSchedulesView, {
    props: {
      api: makeApi(),
      context,
      projectId: props.projectId === undefined ? 'project-1' : props.projectId,
      projectName: props.projectName ?? 'Project One',
    },
  })
}

function mockScheduleBackend(schedules: TaskSchedule[]) {
  invoke.mockImplementation(async (method: string, payload?: { schedule?: Partial<TaskSchedule> }) => {
    if (method === LIST_SCHEDULES_METHOD) return schedules
    if (method === 'saveSchedule') return makeSchedule({
      id: payload?.schedule?.id ?? 'saved-schedule',
      title: payload?.schedule?.title ?? 'Saved schedule',
      prompt: payload?.schedule?.prompt ?? 'Saved prompt',
      createdAt: payload?.schedule?.createdAt ?? Date.UTC(2026, 0, 1, 8),
      lastFireAt: payload?.schedule?.lastFireAt ?? null,
      lastTaskId: payload?.schedule?.lastTaskId ?? null,
      history: payload?.schedule?.history ?? [],
    })
    if (method === 'runNow') return { id: 'fire-1', firedAt: Date.UTC(2026, 0, 1, 10), trigger: 'manual', status: 'started', taskId: 'T-1', message: 'Created and started scheduled Task T-1' }
    if (method === 'deleteSchedule') return { deleted: true }
    throw new Error(`Unexpected backend method: ${method}`)
  })
}

async function waitForInitialLoad(projectId = 'project-1') {
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId })
  })
}

async function waitForSchedulesToLoad() {
  await screen.findByText('Daily dependency triage')
  await screen.findByText('Dormant cleanup review')
}

function getScheduleCard(title: string): HTMLElement {
  const scheduleHeading = screen.getByRole('heading', { name: title })
  const scheduleCard = scheduleHeading.closest('article')
  if (!(scheduleCard instanceof HTMLElement)) throw new Error(`Schedule card for ${title} not found`)
  return scheduleCard
}

async function editScheduleByTitle(title: string) {
  const scheduleCard = getScheduleCard(title)
  const editButton = within(scheduleCard).getByRole('button', { name: 'Edit' })
  await fireEvent.click(editButton)
}

describe('TaskSchedulesView stale project loads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    whenReady.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('ignores stale listSchedules successes from a previous project', async () => {
    const projectALoad = deferred<TaskSchedule[]>()
    invoke
      .mockReturnValueOnce(projectALoad.promise)
      .mockResolvedValueOnce([makeSchedule({ id: 'schedule-b', title: 'Project B schedule' })])

    const { rerender } = renderTaskSchedulesView({ projectId: 'project-a', projectName: 'Project A' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-a' })
    })

    await rerender({ projectId: 'project-b', projectName: 'Project B' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-b' })
      expect(screen.getByText('Project B schedule')).toBeTruthy()
    })

    projectALoad.resolve([makeSchedule({ id: 'schedule-a', title: 'Project A stale schedule' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Project A stale schedule')).toBeNull()
    expect(screen.getByText('Project B schedule')).toBeTruthy()
  })

  it('ignores stale listSchedules errors from a previous project', async () => {
    const projectALoad = deferred<TaskSchedule[]>()
    invoke
      .mockReturnValueOnce(projectALoad.promise)
      .mockResolvedValueOnce([makeSchedule({ id: 'schedule-b', title: 'Project B schedule' })])

    const { rerender } = renderTaskSchedulesView({ projectId: 'project-a', projectName: 'Project A' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-a' })
    })

    await rerender({ projectId: 'project-b', projectName: 'Project B' })

    await waitFor(() => {
      expect(screen.getByText('Project B schedule')).toBeTruthy()
    })

    projectALoad.reject(new Error('Project A stale failure'))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Project A stale failure')).toBeNull()
    expect(screen.getByText('Project B schedule')).toBeTruthy()
  })

  it('keeps loading active when a stale load finishes before the current project load', async () => {
    const projectALoad = deferred<TaskSchedule[]>()
    const projectBLoad = deferred<TaskSchedule[]>()
    invoke
      .mockReturnValueOnce(projectALoad.promise)
      .mockReturnValueOnce(projectBLoad.promise)

    const { rerender } = renderTaskSchedulesView({ projectId: 'project-a', projectName: 'Project A' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-a' })
    })

    await rerender({ projectId: 'project-b', projectName: 'Project B' })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-b' })
    })

    expect(screen.getByLabelText('Loading Task Schedules')).toBeTruthy()

    projectALoad.resolve([makeSchedule({ id: 'schedule-a', title: 'Project A stale schedule' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByLabelText('Loading Task Schedules')).toBeTruthy()
    expect(screen.queryByText('Project A stale schedule')).toBeNull()

    projectBLoad.resolve([makeSchedule({ id: 'schedule-b', title: 'Project B schedule' })])

    await waitFor(() => {
      expect(screen.queryByLabelText('Loading Task Schedules')).toBeNull()
      expect(screen.getByText('Project B schedule')).toBeTruthy()
    })
  })
})

describe('TaskSchedulesView accessibility polish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    whenReady.mockResolvedValue(undefined)
    mockScheduleBackend([enabledSchedule, disabledSchedule])
  })

  afterEach(() => {
    cleanup()
  })

  it('exposes the schedule list and composer as labelled regions', async () => {
    renderTaskSchedulesView({ projectName: 'Demo Project' })

    await waitForSchedulesToLoad()

    expect(screen.getByRole('region', { name: /task schedules list/i })).toBeTruthy()
    expect(screen.getByRole('region', { name: /task schedule (form|composer)/i })).toBeTruthy()
  })

  it('moves focus to the title input and politely announces the schedule when editing', async () => {
    renderTaskSchedulesView({ projectName: 'Demo Project' })
    await waitForSchedulesToLoad()

    await editScheduleByTitle('Daily dependency triage')

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Title'))
    })

    const editAnnouncement = screen.getByRole('status')
    expect(editAnnouncement.getAttribute('aria-live')).toBe('polite')
    expect(editAnnouncement.textContent).toMatch(/editing\s+daily dependency triage/i)
  })

  it('uses enabled-state-aware toggle copy while editing schedules', async () => {
    renderTaskSchedulesView({ projectName: 'Demo Project' })
    await waitForSchedulesToLoad()

    await editScheduleByTitle('Daily dependency triage')
    const enabledToggle = screen.getByLabelText(/schedule enabled/i) as HTMLInputElement
    expect(enabledToggle.checked).toBe(true)
    expect(screen.queryByText(/^Enabled by default$/i)).toBeNull()

    await editScheduleByTitle('Dormant cleanup review')
    const disabledToggle = screen.getByLabelText(/schedule disabled/i) as HTMLInputElement
    expect(disabledToggle.checked).toBe(false)
    expect(screen.queryByText(/^Enabled by default$/i)).toBeNull()
  })

  it('uses the built-in project page header pattern and keeps refresh actionable', async () => {
    renderTaskSchedulesView({ projectName: 'Demo Project' })

    expect(screen.getByRole('heading', { level: 2, name: 'Demo Project — Task Schedules' })).toBeTruthy()

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-1' })
    })

    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2)
    })
    expect(invoke).toHaveBeenLastCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-1' })
  })
})

describe('TaskSchedulesView UX feedback', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    whenReady.mockResolvedValue(undefined)
  })

  it('shows inline cron validation help and does not save invalid custom cron', async () => {
    mockScheduleBackend([])
    renderTaskSchedulesView()
    await waitForInitialLoad()

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Every minute' } })
    await fireEvent.input(screen.getByLabelText('Plain prompt'), { target: { value: 'Check the queue' } })
    await fireEvent.click(screen.getByLabelText('Advanced: use a cron expression'))
    await fireEvent.input(screen.getByLabelText('Cron expression'), { target: { value: 'not a cron' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Task Schedule' }))

    expect(await screen.findByText('Use five fields: minute hour day-of-month month day-of-week.')).toBeTruthy()
    expect(screen.getByLabelText('Cron expression').getAttribute('aria-invalid')).toBe('true')
    expect(invoke).not.toHaveBeenCalledWith('saveSchedule', expect.anything())
  })

  it('announces async save failures without exposing raw cron parser wording', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === LIST_SCHEDULES_METHOD) return []
      if (method === 'saveSchedule') throw new Error('Custom Schedule Preset must use five-field cron syntax')
      throw new Error(`Unexpected method ${method}`)
    })

    renderTaskSchedulesView()
    await waitForInitialLoad()

    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Bad backend cron' } })
    await fireEvent.input(screen.getByLabelText('Plain prompt'), { target: { value: 'Check the queue' } })
    await fireEvent.click(screen.getByLabelText('Advanced: use a cron expression'))
    await fireEvent.input(screen.getByLabelText('Cron expression'), { target: { value: '* * * * *' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Task Schedule' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Fix the highlighted schedule fields and try again.')
    expect(alert.textContent).not.toContain('Custom Schedule Preset')
    expect(screen.getByText('Use five fields: minute hour day-of-month month day-of-week.')).toBeTruthy()
  })

  it('shows per-action pending feedback for run now and refresh', async () => {
    let resolveRunNow!: (value: unknown) => void
    const runNow = new Promise((resolve) => { resolveRunNow = resolve })
    invoke.mockImplementation(async (method: string) => {
      if (method === LIST_SCHEDULES_METHOD) return [makeSchedule()]
      if (method === 'runNow') return runNow
      throw new Error(`Unexpected method ${method}`)
    })

    renderTaskSchedulesView()
    await screen.findByText('Daily dependency triage')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Run now/ }))
    expect(screen.getByRole('button', { name: 'Running now…' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false)

    resolveRunNow({ id: 'fire-1', firedAt: Date.UTC(2026, 0, 1, 10), trigger: 'manual', status: 'started', taskId: 'T-1', message: 'Created and started scheduled Task T-1' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run now/ })).toBeTruthy()
    })
  })

  it('clarifies Run now side effects for create-only and create-and-start schedules', async () => {
    mockScheduleBackend([
      makeSchedule({ id: 'create-only', title: 'Create only', mode: 'create-only' }),
      makeSchedule({ id: 'create-start', title: 'Create start', mode: 'create-and-start' }),
    ])
    renderTaskSchedulesView()

    expect(await screen.findByText('Creates a scheduled board Task immediately without starting implementation.')).toBeTruthy()
    expect(screen.getByText('Creates a scheduled board Task immediately and starts implementation if no previous scheduled Task is still open.')).toBeTruthy()
  })

  it('requires delete confirmation and does not offer undo after deletion', async () => {
    mockScheduleBackend([makeSchedule()])
    renderTaskSchedulesView()
    const card = (await screen.findByText('Daily dependency triage')).closest('article') as HTMLElement

    await fireEvent.click(within(card).getByRole('button', { name: 'Delete' }))
    expect(within(card).getByText('Delete this Task Schedule?')).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('deleteSchedule', expect.anything())

    await fireEvent.click(within(card).getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('deleteSchedule', { projectId: 'project-1', scheduleId: 'schedule-1' })
    })
    expect(screen.queryByRole('button', { name: 'Undo delete' })).toBeNull()
    expect(screen.queryByText('Daily dependency triage')).toBeNull()
  })
})
