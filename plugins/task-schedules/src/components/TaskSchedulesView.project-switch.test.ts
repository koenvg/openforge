import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScheduledFireOutcome, TaskSchedule } from '../lib/types'
import {
  deferred,
  invoke,
  makeSchedule,
  navigate,
  openNewSchedule,
  projectA,
  projectB,
  renderProjectSwitchView,
  resetTaskSchedulesViewMocks,
  selectSchedule,
  settleAsyncWork,
  settleRejectedAsyncWork,
} from './TaskSchedulesView.test-fixtures'

describe('TaskSchedulesView project-switch stale completions', () => {
  beforeEach(() => {
    resetTaskSchedulesViewMocks()
  })

  afterEach(() => cleanup())

  it('ignores stale save completions after switching projects', async () => {
    const pendingSave = deferred<TaskSchedule>()
    const { switchToProjectB } = renderProjectSwitchView({
      projectASchedules: [],
      backendResponses: { saveSchedule: pendingSave.promise },
    })
    await screen.findByText('No schedules found')

    const projectAForm = await openNewSchedule()
    await fireEvent.input(within(projectAForm).getByLabelText(/title/i), { target: { value: 'Project A saved schedule' } })
    await fireEvent.input(within(projectAForm).getByLabelText(/prompt/i), { target: { value: 'Only belongs to Project A.' } })
    await fireEvent.click(within(projectAForm).getByRole('button', { name: 'Create schedule' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', expect.objectContaining({ projectId: projectA.id })))

    await switchToProjectB()
    expect(await screen.findByRole('button', { name: projectB.scheduleTitle })).toBeTruthy()
    const projectBForm = await openNewSchedule()
    expect((within(projectBForm).getByRole('button', { name: 'Create schedule' }) as HTMLButtonElement).disabled).toBe(false)

    pendingSave.resolve(makeSchedule({ title: 'Project A saved schedule' }))
    await settleAsyncWork(pendingSave.promise)

    expect(screen.getByRole('complementary', { name: 'Schedule form' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Project A saved schedule' })).toBeNull()
  })

  it('ignores stale enable or pause completions after switching projects', async () => {
    const pendingToggle = deferred<TaskSchedule>()
    const { switchToProjectB } = renderProjectSwitchView({
      backendResponses: { saveSchedule: pendingToggle.promise },
    })
    const projectAInspector = await selectSchedule(projectA.scheduleTitle)
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSchedule', expect.objectContaining({ projectId: projectA.id })))

    await switchToProjectB()
    const projectBInspector = await selectSchedule(projectB.scheduleTitle)
    expect((within(projectBInspector).getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(false)

    pendingToggle.resolve(makeSchedule({
      title: projectA.scheduleTitle,
      lifecycle: { state: 'active', enabled: false, nextFireAt: Date.UTC(2026, 0, 2, 9) },
    }))
    await settleAsyncWork(pendingToggle.promise)

    expect(within(projectBInspector).getByRole('heading', { name: projectB.scheduleTitle })).toBeTruthy()
    expect(within(projectBInspector).getByText('Enabled')).toBeTruthy()
  })

  it('ignores stale delete completions after switching projects', async () => {
    const pendingDelete = deferred<{ deleted: boolean }>()
    const { switchToProjectB } = renderProjectSwitchView({
      backendResponses: { deleteSchedule: pendingDelete.promise },
    })
    const projectAInspector = await selectSchedule(projectA.scheduleTitle)
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Delete schedule' }))
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete schedule confirmation' })).getByRole('button', { name: 'Delete schedule' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('deleteSchedule', { projectId: projectA.id, scheduleId: 'schedule-1' }))

    await switchToProjectB()
    const projectBInspector = await selectSchedule(projectB.scheduleTitle)
    expect((within(projectBInspector).getByRole('button', { name: 'Delete schedule' }) as HTMLButtonElement).disabled).toBe(false)

    pendingDelete.resolve({ deleted: true })
    await settleAsyncWork(pendingDelete.promise)

    expect(screen.getByRole('button', { name: projectB.scheduleTitle })).toBeTruthy()
    expect(within(projectBInspector).getByRole('heading', { name: projectB.scheduleTitle })).toBeTruthy()
  })

  it('ignores stale Run now completions after switching projects', async () => {
    const pendingRun = deferred<ScheduledFireOutcome>()
    const { switchToProjectB } = renderProjectSwitchView({
      backendResponses: { runNow: pendingRun.promise },
    })
    const projectAInspector = await selectSchedule(projectA.scheduleTitle)
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('runNow', { projectId: projectA.id, scheduleId: 'schedule-1' }))

    await switchToProjectB()
    const projectBInspector = await selectSchedule(projectB.scheduleTitle)
    expect((within(projectBInspector).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(false)

    pendingRun.resolve({ id: 'project-a-run', firedAt: 1, trigger: 'manual', status: 'started', taskId: 'A-1', message: 'Started Project A task' })
    await settleAsyncWork(pendingRun.promise)

    expect(within(projectBInspector).queryByText('Run completed')).toBeNull()
    expect(invoke.mock.calls.filter(([method, payload]) => method === 'listSchedules' && payload?.projectId === projectB.id)).toHaveLength(1)
  })

  it('ignores stale cancellation completions after switching projects', async () => {
    const pendingRun = deferred<ScheduledFireOutcome>()
    const pendingCancellation = deferred<{ cancelled: boolean }>()
    const { switchToProjectB } = renderProjectSwitchView({
      backendResponses: {
        runNow: pendingRun.promise,
        cancelRunNow: pendingCancellation.promise,
      },
    })
    const projectAInspector = await selectSchedule(projectA.scheduleTitle)
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'Run now' }))
    await fireEvent.click(await within(projectAInspector).findByRole('button', { name: 'Cancel run' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancelRunNow', { projectId: projectA.id, scheduleId: 'schedule-1' }))

    await switchToProjectB()
    const projectBInspector = await selectSchedule(projectB.scheduleTitle)

    pendingCancellation.resolve({ cancelled: false })
    await settleAsyncWork(pendingCancellation.promise)

    expect(within(projectBInspector).queryByText('Run completed with a warning')).toBeNull()
    expect((within(projectBInspector).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ignores stale navigation errors after switching projects', async () => {
    const pendingNavigation = deferred<unknown>()
    const projectASchedule = makeSchedule({
      title: projectA.scheduleTitle,
      history: [{ id: 'run-a', firedAt: 1, trigger: 'manual', status: 'started', taskId: 'A-1', message: 'Started A-1' }],
    })
    navigate.mockReturnValue(pendingNavigation.promise)
    const { switchToProjectB } = renderProjectSwitchView({ projectASchedules: [projectASchedule] })
    const projectAInspector = await selectSchedule(projectA.scheduleTitle)
    await fireEvent.click(within(projectAInspector).getByRole('button', { name: 'A-1' }))
    expect(navigate).toHaveBeenCalledWith({ projectId: projectA.id, taskId: 'A-1' })

    await switchToProjectB()
    const projectBInspector = await selectSchedule(projectB.scheduleTitle)

    pendingNavigation.reject(new Error('Project A navigation failed'))
    await settleRejectedAsyncWork(pendingNavigation.promise)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(projectBInspector).getByRole('heading', { name: projectB.scheduleTitle })).toBeTruthy()
  })

  it('ignores stale schedule results after switching projects', async () => {
    const projectALoad = deferred<TaskSchedule[]>()
    const { switchToProjectB } = renderProjectSwitchView({ projectASchedules: projectALoad.promise })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('listSchedules', { projectId: projectA.id }))

    await switchToProjectB()
    expect(await screen.findByRole('button', { name: projectB.scheduleTitle })).toBeTruthy()
    projectALoad.resolve([makeSchedule({ title: 'Project A stale schedule' })])
    await settleAsyncWork(projectALoad.promise)
    expect(screen.queryByRole('button', { name: 'Project A stale schedule' })).toBeNull()
  })
})
