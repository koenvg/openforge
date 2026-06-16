import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
import TaskSchedulesView from './TaskSchedulesView.svelte'
import type { TaskSchedule } from '../lib/types'

const LIST_SCHEDULES_METHOD = 'listSchedules'

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

const invoke = vi.fn()
const whenReady = vi.fn()

function makeApi(): FrontendOpenForgeAPI {
  return {
    backend: { invoke, whenReady },
  } as unknown as FrontendOpenForgeAPI
}

const runtimeContext: OpenForgeContextSnapshot = {
  pluginId: 'com.openforge.task-schedules',
  projectId: 'project-a',
}

function makeSchedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: 'schedule-1',
    title: 'Daily triage',
    prompt: 'Triage dependencies',
    preset: 'daily',
    cron: '0 9 * * *',
    mode: 'create-only',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    nextFireAt: 2,
    lastFireAt: null,
    lastTaskId: null,
    history: [],
    ...overrides,
  }
}

function renderTaskSchedulesView(props: { projectId?: string | null; projectName?: string } = {}) {
  return render(TaskSchedulesView, {
    props: {
      api: makeApi(),
      context: runtimeContext,
      projectId: props.projectId === undefined ? 'project-a' : props.projectId,
      projectName: props.projectName ?? 'Project A',
    },
  })
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
