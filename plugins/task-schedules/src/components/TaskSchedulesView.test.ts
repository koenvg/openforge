import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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
    title: 'Daily dependency triage',
    prompt: 'Review dependency update tasks and create follow-up work.',
    preset: 'daily',
    cron: '0 9 * * *',
    mode: 'create-and-start',
    enabled: true,
    createdAt: Date.UTC(2026, 0, 1),
    updatedAt: Date.UTC(2026, 0, 1),
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
      context: runtimeContext,
      projectId: props.projectId === undefined ? 'project-a' : props.projectId,
      projectName: props.projectName ?? 'Project A',
    },
  })
}

function mockScheduleList(schedules: TaskSchedule[]) {
  invoke.mockImplementation(async (method: string) => {
    if (method === LIST_SCHEDULES_METHOD) return schedules
    throw new Error(`Unexpected backend method: ${method}`)
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

async function editSchedule(title: string) {
  const scheduleCard = getScheduleCard(title)
  const editButton = Array.from(scheduleCard.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit')
  if (!editButton) throw new Error(`Edit button for ${title} not found`)
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
    mockScheduleList([enabledSchedule, disabledSchedule])
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

    await editSchedule('Daily dependency triage')

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

    await editSchedule('Daily dependency triage')
    const enabledToggle = screen.getByLabelText(/schedule enabled/i) as HTMLInputElement
    expect(enabledToggle.checked).toBe(true)
    expect(screen.queryByText(/^Enabled by default$/i)).toBeNull()

    await editSchedule('Dormant cleanup review')
    const disabledToggle = screen.getByLabelText(/schedule disabled/i) as HTMLInputElement
    expect(disabledToggle.checked).toBe(false)
    expect(screen.queryByText(/^Enabled by default$/i)).toBeNull()
  })

  it('uses the built-in project page header pattern and keeps refresh actionable', async () => {
    renderTaskSchedulesView({ projectName: 'Demo Project' })

    expect(screen.getByRole('heading', { level: 2, name: 'Demo Project — Task Schedules' })).toBeTruthy()

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-a' })
    })

    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2)
    })
    expect(invoke).toHaveBeenLastCalledWith(LIST_SCHEDULES_METHOD, { projectId: 'project-a' })
  })
})
