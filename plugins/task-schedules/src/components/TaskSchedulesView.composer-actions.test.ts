import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScheduledFireOutcome } from '../lib/types'
import {
  deferred,
  enabledSchedule,
  invoke,
  makeSchedule,
  mockBackend,
  navigate,
  openNewSchedule,
  pausedSchedule,
  renderView,
  resetTaskSchedulesViewMocks,
  selectSchedule,
  waitForSchedules,
} from './TaskSchedulesView.test-fixtures'

describe('TaskSchedulesView composer and actions', () => {
  beforeEach(() => {
    resetTaskSchedulesViewMocks()
  })

  afterEach(() => cleanup())

  it('edits the date and time of a future one-off schedule', async () => {
    const initialRunAtValue = '2099-08-26T13:45'
    const updatedRunAtValue = '2099-08-27T10:15'
    const oneOff = makeSchedule({
      id: 'schedule-future-once',
      title: 'Future dependency retry',
      timing: { type: 'once', runAt: new Date(initialRunAtValue).getTime() },
      lifecycle: { state: 'active', enabled: true, nextFireAt: new Date(initialRunAtValue).getTime() },
    })
    mockBackend([oneOff])
    renderView()

    const inspector = await selectSchedule('Future dependency retry')
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('complementary', { name: 'Task Schedule form' })
    const oneTime = within(form).getByRole('radio', { name: /One time/i }) as HTMLInputElement
    expect(oneTime.checked).toBe(true)
    expect(oneTime.disabled).toBe(true)
    expect(within(form).getByText('Task Schedule type can’t be changed after creation.')).toBeTruthy()
    const runAt = within(form).getByLabelText(/^Run on/i) as HTMLInputElement
    expect(runAt.value).toBe(initialRunAtValue)

    await fireEvent.input(runAt, { target: { value: updatedRunAtValue } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({
        id: 'schedule-future-once',
        kind: 'once',
        runAt: new Date(updatedRunAtValue).getTime(),
      }),
    }))
  })

  it('preserves the exact one-off timestamp when editing other fields', async () => {
    const exactRunAt = new Date('2099-08-26T13:45:32.456').getTime()
    const oneOff = makeSchedule({
      id: 'schedule-exact-once',
      title: 'Exact dependency retry',
      timing: { type: 'once', runAt: exactRunAt },
      lifecycle: { state: 'active', enabled: true, nextFireAt: exactRunAt },
    })
    mockBackend([oneOff])
    renderView()

    const inspector = await selectSchedule('Exact dependency retry')
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('complementary', { name: 'Task Schedule form' })
    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Exact dependency retry updated' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ id: 'schedule-exact-once', runAt: exactRunAt }),
    }))
  })


  it('opens creation in a dedicated drawer, progressively reveals cron, and focuses invalid input', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')

    const form = await openNewSchedule()
    expect(document.activeElement).toBe(within(form).getByLabelText(/title/i))
    expect(within(form).getByRole('heading', { name: 'New Task Schedule' })).toBeTruthy()
    expect(within(form).getByText('This becomes the Task prompt for every scheduled run.')).toBeTruthy()
    expect(within(form).getByText('Creates a Task and starts implementation when the previous scheduled Task is closed.')).toBeTruthy()
    expect(within(form).getByText('Paused Task Schedules can still be run manually.')).toBeTruthy()
    const enabledSwitch = within(form).getByRole('switch', { name: 'Enable after creation' }) as HTMLInputElement
    expect(enabledSwitch.checked).toBe(true)
    expect(within(form).queryByLabelText('Cron expression')).toBeNull()

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Every minute' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'Check the queue' } })
    await fireEvent.click(within(form).getByLabelText('Use a custom cron expression'))
    const cron = within(form).getByLabelText('Cron expression')
    await fireEvent.input(cron, { target: { value: '* * * * *' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create Task Schedule' }))

    expect(await within(form).findByText(/at most once every 5 minutes/i)).toBeTruthy()
    expect(cron.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(cron))
    expect(invoke).not.toHaveBeenCalledWith('saveSchedule', expect.anything())
  })

  it('preserves timing fields while changing the new Task Schedule type', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')
    const form = await openNewSchedule()
    const cronValue = '0 8 * * 1'
    const runAtValue = '2099-08-26T13:45'

    await fireEvent.click(within(form).getByLabelText('Use a custom cron expression'))
    await fireEvent.input(within(form).getByLabelText('Cron expression'), { target: { value: cronValue } })
    await fireEvent.click(within(form).getByRole('radio', { name: /One time/i }))
    await fireEvent.input(within(form).getByLabelText(/^Run on/i), { target: { value: runAtValue } })

    await fireEvent.click(within(form).getByRole('radio', { name: /Recurring/i }))
    expect((within(form).getByLabelText('Cron expression') as HTMLInputElement).value).toBe(cronValue)

    await fireEvent.click(within(form).getByRole('radio', { name: /One time/i }))
    expect((within(form).getByLabelText(/^Run on/i) as HTMLInputElement).value).toBe(runAtValue)
  })

  it('protects unsaved changes and returns focus to New Task Schedule after dismissal', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')
    const form = await openNewSchedule()

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Unsaved schedule' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Close Task Schedule form' }))

    const dialog = screen.getByRole('dialog', { name: 'Discard Task Schedule changes' })
    expect(within(dialog).getByText(/not been saved/i)).toBeTruthy()
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('complementary', { name: 'Task Schedule form' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Close Task Schedule form' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('complementary', { name: 'Task Schedule form' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New Task Schedule' })))
  })

  it('creates a one-off schedule for a local date and time', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')
    const form = await openNewSchedule()
    const runAtValue = '2099-08-26T13:45'

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Resume dependency upgrade' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'Continue the dependency upgrade.' } })
    await fireEvent.click(within(form).getByRole('radio', { name: /One time/i }))
    const runAt = await within(form).findByLabelText(/^Run on/i)
    expect(within(form).queryByLabelText('Frequency')).toBeNull()
    await fireEvent.input(runAt, { target: { value: runAtValue } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create Task Schedule' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({
        title: 'Resume dependency upgrade',
        kind: 'once',
        runAt: new Date(runAtValue).getTime(),
        preset: null,
        cron: null,
      }),
    }))
  })

  it('focuses a one-off date that is not in the future', async () => {
    mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')
    const form = await openNewSchedule()

    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Expired schedule' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'This should not be created.' } })
    await fireEvent.click(within(form).getByRole('radio', { name: /One time/i }))
    const runAt = await within(form).findByLabelText(/^Run on/i)
    await fireEvent.input(runAt, { target: { value: '2000-01-01T09:00' } })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create Task Schedule' }))

    expect(await within(form).findByText('Choose a date and time in the future.')).toBeTruthy()
    expect(runAt.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(runAt))
    expect(invoke).not.toHaveBeenCalledWith('saveSchedule', expect.anything())
  })

  it('creates and edits schedules through labelled forms', async () => {
    mockBackend([enabledSchedule])
    renderView()
    await screen.findByRole('button', { name: 'Daily dependency triage' })

    let form = await openNewSchedule()
    await fireEvent.input(within(form).getByLabelText(/title/i), { target: { value: 'Release notes' } })
    await fireEvent.input(within(form).getByLabelText(/prompt/i), { target: { value: 'Draft weekly release notes.' } })
    const modeSelect = within(form).getByRole('button', { name: 'Mode' })
    modeSelect.focus()
    await fireEvent.keyDown(modeSelect, { key: 'ArrowDown' })
    await fireEvent.keyDown(modeSelect, { key: 'ArrowDown' })
    await fireEvent.keyDown(modeSelect, { key: 'Enter' })
    await fireEvent.click(within(form).getByRole('button', { name: 'Create Task Schedule' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', {
      projectId: 'project-1',
      schedule: expect.objectContaining({ title: 'Release notes', prompt: 'Draft weekly release notes.', mode: 'create-only' }),
    }))
    expect(screen.getByRole('complementary', { name: 'Task Schedule details' })).toBeTruthy()

    await selectSchedule('Daily dependency triage')
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    form = screen.getByRole('complementary', { name: 'Task Schedule form' })
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

    await fireEvent.click(within(inspector).getByRole('button', { name: 'Delete Task Schedule' }))
    expect(invoke).not.toHaveBeenCalledWith('deleteSchedule', expect.anything())
    const dialog = screen.getByRole('dialog', { name: 'Delete Task Schedule confirmation' })
    expect(within(dialog).getByText('This permanently deletes the Task Schedule. Existing Tasks and run history outside this Task Schedule are not removed.')).toBeTruthy()
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Task Schedule' }))

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

})
