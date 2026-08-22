import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScheduledFireOutcome, TaskSchedule } from '../lib/types'
import {
  deferred,
  invoke,
  makeSchedule,
  navigate,
  openNewSchedule,
  renderView,
  resetTaskSchedulesViewMocks,
  selectSchedule,
} from './TaskSchedulesView.test-fixtures'

describe('TaskSchedulesView project-switch stale completions', () => {
  beforeEach(() => {
    resetTaskSchedulesViewMocks()
  })

  afterEach(() => cleanup())

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
