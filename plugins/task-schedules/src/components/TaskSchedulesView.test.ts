import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
import type { ScheduledFireOutcome, TaskSchedule } from '../lib/types'
import TaskSchedulesView from './TaskSchedulesView.svelte'

const whenReady = vi.fn()
const invoke = vi.fn()
const navigate = vi.fn()

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
    navigation: { navigate },
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
    kind: 'recurring',
    preset: 'daily',
    cron: '0 9 * * *',
    runAt: null,
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1, 8),
    updatedAt: Date.UTC(2026, 0, 1, 8),
    nextFireAt: Date.UTC(2026, 0, 2, 9),
    lastFireAt: null,
    lastTaskId: null,
    cancelledAt: null,
    idempotencyKey: null,
    history: [],
    ...overrides,
  }
}

const enabledSchedule = makeSchedule()
const pausedSchedule = makeSchedule({
  id: 'schedule-2',
  title: 'Dormant cleanup review',
  prompt: 'Check stale cleanup tasks but do not run automatically yet.',
  enabled: false,
  nextFireAt: Date.UTC(2026, 0, 3, 9),
})

function renderView(props: { projectId?: string | null; projectName?: string } = {}) {
  return render(TaskSchedulesView, {
    props: {
      api: makeApi(),
      context,
      projectId: props.projectId === undefined ? 'project-1' : props.projectId,
      projectName: props.projectName ?? 'Project One',
    },
  })
}

function mockBackend(initialSchedules: TaskSchedule[]) {
  let schedules = initialSchedules
  invoke.mockImplementation(async (method: string, payload?: Record<string, any>) => {
    if (method === 'listSchedules') return schedules
    if (method === 'saveSchedule') {
      const input = payload?.schedule ?? {}
      const existing = schedules.find((schedule) => schedule.id === input.id)
      const saved = makeSchedule({
        ...existing,
        id: input.id ?? 'saved-schedule',
        title: input.title,
        prompt: input.prompt,
        preset: input.preset,
        cron: input.cron ?? existing?.cron ?? '0 9 * * *',
        mode: input.mode,
        enabled: input.enabled,
      })
      schedules = existing
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      return saved
    }
    if (method === 'runNow') {
      return {
        id: 'fire-1',
        firedAt: Date.UTC(2026, 0, 1, 10),
        trigger: 'manual',
        status: 'started',
        taskId: 'T-1',
        message: 'Created and started scheduled Task T-1',
      } satisfies ScheduledFireOutcome
    }
    if (method === 'cancelRunNow') return { cancelled: true }
    if (method === 'deleteSchedule') {
      schedules = schedules.filter((schedule) => schedule.id !== payload?.scheduleId)
      return { deleted: true }
    }
    throw new Error(`Unexpected backend method: ${method}`)
  })
  return {
    setSchedules(nextSchedules: TaskSchedule[]) {
      schedules = nextSchedules
    },
  }
}

async function waitForSchedules() {
  await screen.findByRole('button', { name: 'Daily dependency triage' })
  await screen.findByRole('button', { name: 'Dormant cleanup review' })
}

async function selectSchedule(title = 'Daily dependency triage') {
  await fireEvent.click(await screen.findByRole('button', { name: title }))
  return screen.getByRole('complementary', { name: 'Schedule details' })
}

async function openNewSchedule() {
  await fireEvent.click(screen.getByRole('button', { name: 'New schedule' }))
  return screen.getByRole('complementary', { name: 'Schedule form' })
}

describe('TaskSchedulesView workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    whenReady.mockResolvedValue(undefined)
    navigate.mockResolvedValue({})
  })

  afterEach(() => cleanup())

  it('filters, sorts, and opens a selected schedule in a resizable inspector without search or refresh actions', async () => {
    mockBackend([enabledSchedule, pausedSchedule])
    renderView({ projectName: 'Demo Project' })
    await waitForSchedules()

    expect(screen.getByRole('heading', { name: 'Task Schedules' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Task schedules' })).toBeTruthy()
    expect(screen.getByLabelText('Schedule summary').textContent).toMatch(/2\s*schedules.*1\s*enabled.*Next run/i)
    expect(screen.queryByRole('searchbox', { name: 'Search schedules' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Paused schedules' }))
    expect(screen.queryByRole('button', { name: 'Daily dependency triage' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dormant cleanup review' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'All schedules' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Sort by schedule' }))
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Daily dependency triage')
    expect(screen.getByRole('columnheader', { name: /schedule/i }).getAttribute('aria-sort')).toBe('ascending')

    const inspector = await selectSchedule('Dormant cleanup review')
    expect(within(inspector).getByRole('heading', { name: 'Dormant cleanup review' })).toBeTruthy()
    expect(within(inspector).getByText(pausedSchedule.prompt)).toBeTruthy()
    expect(within(inspector).getByText('Paused')).toBeTruthy()
    expect(screen.getByTestId('resize-handle').getAttribute('aria-label')).toMatch(/schedule details/i)
  })

  it('shows agent-created one-off schedules and keeps completed runs inspectable', async () => {
    const runAt = Date.UTC(2026, 7, 26, 13, 46)
    const oneOff = makeSchedule({
      id: 'schedule-once',
      title: 'Resume dependency upgrade',
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      enabled: false,
      nextFireAt: null,
      lastFireAt: runAt,
      history: [{ id: 'run-once', firedAt: runAt, trigger: 'scheduled', status: 'started', taskId: 'KVG-4000', message: 'Started KVG-4000' }],
    })
    mockBackend([oneOff])

    renderView()
    const scheduleButton = await screen.findByRole('button', { name: 'Resume dependency upgrade' })
    const row = scheduleButton.closest('tr')
    expect(row?.textContent).toContain('One time')
    expect(row?.textContent).toContain('Completed')

    const inspector = await selectSchedule('Resume dependency upgrade')
    expect(within(inspector).getByText('Completed')).toBeTruthy()
    expect(within(inspector).getByText('One time')).toBeTruthy()
    expect(within(inspector).getByRole('button', { name: 'KVG-4000' })).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  it('keeps cancelled one-off schedules visible without runnable actions', async () => {
    const runAt = Date.UTC(2026, 7, 26, 13, 46)
    const cancelled = makeSchedule({
      id: 'schedule-cancelled',
      title: 'Cancelled dependency retry',
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      enabled: false,
      nextFireAt: runAt,
      cancelledAt: Date.UTC(2026, 7, 22, 9),
    })
    mockBackend([cancelled])

    renderView()
    const inspector = await selectSchedule('Cancelled dependency retry')

    expect(within(inspector).getByText('Cancelled')).toBeTruthy()
    expect(within(inspector).getByText('One time')).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  it('refreshes the mounted view when agent-created schedules may have changed', async () => {
    const runAt = Date.UTC(2026, 7, 26, 13, 46)
    const backend = mockBackend([])
    renderView()
    await screen.findByText('No schedules found')

    backend.setSchedules([makeSchedule({
      id: 'schedule-agent',
      title: 'Agent-created retry',
      kind: 'once',
      preset: null,
      cron: null,
      runAt,
      nextFireAt: runAt,
    })])
    window.dispatchEvent(new Event('focus'))

    expect(await screen.findByRole('button', { name: 'Agent-created retry' })).toBeTruthy()
  })
  it('selects a schedule when clicking anywhere on its row and supports keyboard row selection', async () => {
    mockBackend([enabledSchedule])
    renderView()
    const scheduleButton = await screen.findByRole('button', { name: 'Daily dependency triage' })
    const row = scheduleButton.closest('tr')
    if (!(row instanceof HTMLTableRowElement)) throw new Error('Expected schedule row')

    await fireEvent.click(within(row).getByText('Create + start'))
    expect(screen.getByRole('complementary', { name: 'Schedule details' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Close schedule details' }))
    row.focus()
    await fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: 'Schedule details' })).toBeTruthy()
  })

  it('opens creation in a dedicated drawer, progressively reveals cron, and focuses invalid input', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No schedules found')

    const form = await openNewSchedule()
    expect(document.activeElement).toBe(within(form).getByLabelText(/title/i))
    expect(within(form).queryByLabelText('Cron expression')).toBeNull()

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Every minute' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'Check the queue' } })
    await fireEvent.click(within(form).getByLabelText('Use a custom cron expression'))
    const cron = within(form).getByLabelText('Cron expression')
    await fireEvent.input(cron, { target: { value: '* * * * *' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create schedule' }))

    expect(await within(form).findByText(/at most once every 5 minutes/i)).toBeTruthy()
    expect(cron.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(cron))
    expect(invoke).not.toHaveBeenCalledWith('saveSchedule', expect.anything())
  })

  it('protects unsaved changes and returns focus to New schedule after dismissal', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No schedules found')
    const form = await openNewSchedule()

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Unsaved schedule' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Close schedule form' }))

    const dialog = screen.getByRole('dialog', { name: 'Discard schedule changes' })
    expect(within(dialog).getByText(/not been saved/i)).toBeTruthy()
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('complementary', { name: 'Schedule form' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Close schedule form' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('complementary', { name: 'Schedule form' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New schedule' })))
  })

  it('creates and edits schedules through labelled forms', async () => {
    mockBackend([enabledSchedule])
    renderView()
    await screen.findByRole('button', { name: 'Daily dependency triage' })

    let form = await openNewSchedule()
    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Release notes' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'Draft weekly release notes.' } })
    await fireEvent.change(within(form).getByLabelText('Mode'), { target: { value: 'create-only' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ title: 'Release notes', prompt: 'Draft weekly release notes.', mode: 'create-only' }),
    }))
    expect(screen.getByRole('complementary', { name: 'Schedule details' })).toBeTruthy()

    await selectSchedule('Daily dependency triage')
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    form = screen.getByRole('complementary', { name: 'Schedule form' })
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText(/title/i)))
    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Dependency triage updated' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ id: 'schedule-1', title: 'Dependency triage updated' }),
    }))
  })

  it('pauses and enables a schedule from contextual inspector actions', async () => {
    mockBackend([enabledSchedule, pausedSchedule])
    renderView()
    await waitForSchedules()

    let inspector = await selectSchedule()
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ id: 'schedule-1', enabled: false }),
    }))
    expect(within(inspector).getByText('Paused')).toBeTruthy()

    inspector = await selectSchedule('Dormant cleanup review')
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Enable' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ id: 'schedule-2', enabled: true }),
    }))
  })

  it('prevents duplicate Run now submissions and exposes cancellation progress', async () => {
    const pendingRun = deferred<ScheduledFireOutcome>()
    mockBackend([enabledSchedule])
    const originalImplementation = invoke.getMockImplementation()!
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'runNow') return pendingRun.promise
      return originalImplementation(method, payload)
    })
    renderView()
    const inspector = await selectSchedule()

    const runButton = within(inspector).getByRole('button', { name: 'Run now' }) as HTMLButtonElement
    await fireEvent.click(runButton)
    expect(within(inspector).getByText('Running now…')).toBeTruthy()
    expect(runButton.disabled).toBe(true)
    await fireEvent.click(runButton)
    expect(invoke.mock.calls.filter(([method]) => method === 'runNow')).toHaveLength(1)

    await fireEvent.click(within(inspector).getByRole('button', { name: 'Cancel run' }))
    expect(within(inspector).getByText('Cancelling…')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('cancelRunNow', { projectId: 'project-1', scheduleId: 'schedule-1' })

    pendingRun.resolve({ id: 'cancelled', firedAt: 1, trigger: 'manual', status: 'cancelled', taskId: 'T-1', message: 'Cancelled before starting implementation' })
    expect(await within(inspector).findByText('Run cancelled')).toBeTruthy()
  })

  it.each([
    ['started', 'Created and started T-1', 'Run completed'],
    ['skipped', 'Previous task is still open', 'Run completed with a warning'],
    ['failed', 'Could not create task', 'Run failed'],
  ] as const)('announces %s Run now outcomes', async (status, message, heading) => {
    mockBackend([enabledSchedule])
    const originalImplementation = invoke.getMockImplementation()!
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'runNow') return Promise.resolve({ id: 'outcome', firedAt: 1, trigger: 'manual', status, message })
      return originalImplementation(method, payload)
    })
    renderView()
    const inspector = await selectSchedule()
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Run now' }))
    expect(await within(inspector).findByText(heading)).toBeTruthy()
    expect(within(inspector).getByText(message)).toBeTruthy()
  })

  it('surfaces an already-running backend response without allowing another submission', async () => {
    mockBackend([enabledSchedule])
    const originalImplementation = invoke.getMockImplementation()!
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'runNow') return Promise.reject(new Error('This Task Schedule is already running'))
      return originalImplementation(method, payload)
    })
    renderView()
    const inspector = await selectSchedule()
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Run now' }))
    expect(await within(inspector).findByText('Already running')).toBeTruthy()
  })

  it('keeps deletion separate and requires explicit confirmation', async () => {
    mockBackend([enabledSchedule])
    renderView()
    const inspector = await selectSchedule()

    await fireEvent.click(within(inspector).getByRole('button', { name: 'Delete schedule' }))
    expect(invoke).not.toHaveBeenCalledWith('deleteSchedule', expect.anything())
    const dialog = screen.getByRole('dialog', { name: 'Delete schedule confirmation' })
    expect(within(dialog).getByText(/permanently deletes/i)).toBeTruthy()
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete schedule' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deleteSchedule', { projectId: 'project-1', scheduleId: 'schedule-1' }))
    expect(screen.queryByRole('button', { name: 'Daily dependency triage' })).toBeNull()
  })

  it('links recent runs to their tasks through plugin navigation', async () => {
    mockBackend([makeSchedule({ history: [{ id: 'run-1', firedAt: 1, trigger: 'scheduled', status: 'started', taskId: 'KVG-3098', message: 'Started KVG-3098' }] })])
    renderView()
    const inspector = await selectSchedule()

    await fireEvent.click(within(inspector).getByRole('button', { name: 'KVG-3098' }))
    expect(navigate).toHaveBeenCalledWith({ projectId: 'project-1', taskId: 'KVG-3098' })
  })

  it('shows slow loading, reports errors, and recovers through Retry', async () => {
    const firstLoad = deferred<TaskSchedule[]>()
    invoke.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce([enabledSchedule])
    renderView()

    expect(screen.getByLabelText('Loading Task Schedules')).toBeTruthy()
    firstLoad.reject(new Error('Schedules are temporarily unavailable'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Schedules are temporarily unavailable')

    await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Daily dependency triage' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores stale save completions after switching projects', async () => {
    const pendingSave = deferred<TaskSchedule>()
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [])
      if (method === 'saveSchedule') return pendingSave.promise
      throw new Error(`Unexpected backend method: ${method}`)
    })
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    await screen.findByText('No schedules found')

    const projectAForm = await openNewSchedule()
    await fireEvent.input(within(projectAForm).getByLabelText(/title/i), { target: { value: 'Project A saved schedule' } })
    await fireEvent.input(within(projectAForm).getByLabelText(/prompt/i), { target: { value: 'Only belongs to Project A.' } })
    await fireEvent.click(within(projectAForm).getByRole('button', { name: 'Create schedule' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', expect.objectContaining({ projectId: 'project-a' })))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    expect(await screen.findByRole('button', { name: 'Project B schedule' })).toBeTruthy()
    const projectBForm = await openNewSchedule()
    expect((within(projectBForm).getByRole('button', { name: 'Create schedule' }) as HTMLButtonElement).disabled).toBe(false)

    pendingSave.resolve(makeSchedule({ title: 'Project A saved schedule' }))
    await pendingSave.promise
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByRole('complementary', { name: 'Schedule form' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Project A saved schedule' })).toBeNull()
  })

  it('ignores stale enable or pause completions after switching projects', async () => {
    const pendingToggle = deferred<TaskSchedule>()
    const projectASchedule = makeSchedule({ title: 'Project A schedule' })
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [projectASchedule])
      if (method === 'saveSchedule') return pendingToggle.promise
      throw new Error(`Unexpected backend method: ${method}`)
    })
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    const projectAInspector = await selectSchedule('Project A schedule')
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', expect.objectContaining({ projectId: 'project-a' })))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    const projectBInspector = await selectSchedule('Project B schedule')
    expect((within(projectBInspector).getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(false)

    pendingToggle.resolve(makeSchedule({ title: 'Project A schedule', enabled: false }))
    await pendingToggle.promise
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(within(projectBInspector).getByRole('heading', { name: 'Project B schedule' })).toBeTruthy()
    expect(within(projectBInspector).getByText('Enabled')).toBeTruthy()
  })

  it('ignores stale delete completions after switching projects', async () => {
    const pendingDelete = deferred<{ deleted: boolean }>()
    const projectASchedule = makeSchedule({ title: 'Project A schedule' })
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [projectASchedule])
      if (method === 'deleteSchedule') return pendingDelete.promise
      throw new Error(`Unexpected backend method: ${method}`)
    })
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    const projectAInspector = await selectSchedule('Project A schedule')
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Delete schedule' }))
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete schedule confirmation' })).getByRole('button', { name: 'Delete schedule' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deleteSchedule', { projectId: 'project-a', scheduleId: 'schedule-1' }))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    const projectBInspector = await selectSchedule('Project B schedule')
    expect((within(projectBInspector).getByRole('button', { name: 'Delete schedule' }) as HTMLButtonElement).disabled).toBe(false)

    pendingDelete.resolve({ deleted: true })
    await pendingDelete.promise
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByRole('button', { name: 'Project B schedule' })).toBeTruthy()
    expect(within(projectBInspector).getByRole('heading', { name: 'Project B schedule' })).toBeTruthy()
  })

  it('ignores stale Run now completions after switching projects', async () => {
    const pendingRun = deferred<ScheduledFireOutcome>()
    const projectASchedule = makeSchedule({ title: 'Project A schedule' })
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [projectASchedule])
      if (method === 'runNow') return pendingRun.promise
      throw new Error(`Unexpected backend method: ${method}`)
    })
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    const projectAInspector = await selectSchedule('Project A schedule')
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('runNow', { projectId: 'project-a', scheduleId: 'schedule-1' }))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    const projectBInspector = await selectSchedule('Project B schedule')
    expect((within(projectBInspector).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(false)

    pendingRun.resolve({ id: 'project-a-run', firedAt: 1, trigger: 'manual', status: 'started', taskId: 'A-1', message: 'Started Project A task' })
    await pendingRun.promise
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(within(projectBInspector).queryByText('Run completed')).toBeNull()
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'listSchedules' && payload?.projectId === 'project-b')).toHaveLength(1)
  })

  it('ignores stale cancellation completions after switching projects', async () => {
    const pendingRun = deferred<ScheduledFireOutcome>()
    const pendingCancellation = deferred<{ cancelled: boolean }>()
    const projectASchedule = makeSchedule({ title: 'Project A schedule' })
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [projectASchedule])
      if (method === 'runNow') return pendingRun.promise
      if (method === 'cancelRunNow') return pendingCancellation.promise
      throw new Error(`Unexpected backend method: ${method}`)
    })
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    const projectAInspector = await selectSchedule('Project A schedule')
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Run now' }))
    await fireEvent.click(await within(projectAInspector).findByRole('button', { name: 'Cancel run' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancelRunNow', { projectId: 'project-a', scheduleId: 'schedule-1' }))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    const projectBInspector = await selectSchedule('Project B schedule')

    pendingCancellation.resolve({ cancelled: false })
    await pendingCancellation.promise
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(within(projectBInspector).queryByText('Run completed with a warning')).toBeNull()
    expect((within(projectBInspector).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ignores stale navigation errors after switching projects', async () => {
    const pendingNavigation = deferred<unknown>()
    const projectASchedule = makeSchedule({
      title: 'Project A schedule',
      history: [{ id: 'run-a', firedAt: 1, trigger: 'manual', status: 'started', taskId: 'A-1', message: 'Started A-1' }],
    })
    const projectBSchedule = makeSchedule({ title: 'Project B schedule' })
    invoke.mockImplementation((method: string, payload?: Record<string, any>) => {
      if (method === 'listSchedules') return Promise.resolve(payload?.projectId === 'project-b' ? [projectBSchedule] : [projectASchedule])
      throw new Error(`Unexpected backend method: ${method}`)
    })
    navigate.mockReturnValue(pendingNavigation.promise)
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    const projectAInspector = await selectSchedule('Project A schedule')
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'A-1' }))
    expect(navigate).toHaveBeenCalledWith({ projectId: 'project-a', taskId: 'A-1' })

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    const projectBInspector = await selectSchedule('Project B schedule')

    pendingNavigation.reject(new Error('Project A navigation failed'))
    await pendingNavigation.promise.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(projectBInspector).getByRole('heading', { name: 'Project B schedule' })).toBeTruthy()
  })

  it('ignores stale schedule results after switching projects', async () => {
    const projectALoad = deferred<TaskSchedule[]>()
    invoke.mockReturnValueOnce(projectALoad.promise).mockResolvedValueOnce([makeSchedule({ id: 'schedule-b', title: 'Project B schedule' })])
    const { rerender } = renderView({ projectId: 'project-a', projectName: 'Project A' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('listSchedules', { projectId: 'project-a' }))

    await rerender({ projectId: 'project-b', projectName: 'Project B' })
    expect(await screen.findByRole('button', { name: 'Project B schedule' })).toBeTruthy()
    projectALoad.resolve([makeSchedule({ title: 'Project A stale schedule' })])

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: 'Project A stale schedule' })).toBeNull()
  })
})
