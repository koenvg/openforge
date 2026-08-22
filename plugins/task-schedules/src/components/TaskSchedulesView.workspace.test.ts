import { cleanup, fireEvent, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskSchedule } from '../lib/types'
import {
  deferred,
  enabledSchedule,
  invoke,
  makeSchedule,
  mockBackend,
  pausedSchedule,
  renderView,
  resetTaskSchedulesViewMocks,
  selectSchedule,
  waitForSchedules,
} from './TaskSchedulesView.test-fixtures'

describe('TaskSchedulesView workspace', () => {
  beforeEach(() => {
    resetTaskSchedulesViewMocks()
  })

  afterEach(() => cleanup())

  it('filters, sorts, and opens a selected schedule in a resizable inspector without search or refresh actions', async () => {
    mockBackend([enabledSchedule, pausedSchedule])
    renderView({ projectName: 'Demo Project' })
    await waitForSchedules()

    expect(screen.getByRole('heading', { name: 'Task Schedules' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Task Schedules' })).toBeTruthy()
    expect(screen.getByLabelText('Task Schedule summary').textContent).toMatch(/2\s*Task Schedules.*1\s*enabled.*Next run/)
    expect(screen.queryByRole('searchbox', { name: 'Search Task Schedules' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Paused Task Schedules' }))
    expect(screen.queryByRole('button', { name: 'Daily dependency triage' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dormant cleanup review' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'All Task Schedules' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Sort by Task Schedule' }))
    expect(screen.getAllByRole('row')[1]?.textContent).toContain('Daily dependency triage')
    expect(screen.getByRole('columnheader', { name: /Task Schedule/ }).getAttribute('aria-sort')).toBe('ascending')

    const inspector = await selectSchedule('Dormant cleanup review')
    expect(within(inspector).getByRole('heading', { name: 'Dormant cleanup review' })).toBeTruthy()
    expect(within(inspector).getByText(pausedSchedule.prompt)).toBeTruthy()
    expect(within(inspector).getByText('Paused')).toBeTruthy()
    expect(within(inspector).getByText('Creates a board Task and starts implementation when no previous scheduled Task is still open.')).toBeTruthy()
    expect(screen.getByTestId('resize-handle').getAttribute('aria-label')).toMatch(/Task Schedule details/)
  })

  it('shows agent-created one-off schedules and keeps completed runs inspectable', async () => {
    const runAt = Date.now() - 24 * 60 * 60 * 1_000
    const oneOff = makeSchedule({
      id: 'schedule-once',
      title: 'Resume dependency upgrade',
      timing: { type: 'once', runAt },
      lifecycle: { state: 'completed', completedAt: runAt },
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
    expect(within(inspector).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: /Pause|Enable/ })).toBeNull()
  })

  it('keeps cancelled one-off schedules visible without runnable actions', async () => {
    const now = Date.now()
    const runAt = now + 24 * 60 * 60 * 1_000
    const cancelled = makeSchedule({
      id: 'schedule-cancelled',
      title: 'Cancelled dependency retry',
      timing: { type: 'once', runAt },
      lifecycle: { state: 'cancelled', cancelledAt: now - 24 * 60 * 60 * 1_000 },
    })
    mockBackend([cancelled])

    renderView()
    const inspector = await selectSchedule('Cancelled dependency retry')

    expect(within(inspector).getByText('Cancelled')).toBeTruthy()
    expect(within(inspector).getByText('One time')).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: /Pause|Enable/ })).toBeNull()
  })

  it('keeps cancelled recurring schedules inspectable without runnable actions', async () => {
    const cancelled = makeSchedule({
      id: 'schedule-cancelled-recurring',
      title: 'Cancelled recurring dependency retry',
      lifecycle: { state: 'cancelled', cancelledAt: Date.now() - 24 * 60 * 60 * 1_000 },
    })
    mockBackend([cancelled])

    renderView()
    const inspector = await selectSchedule('Cancelled recurring dependency retry')

    expect(within(inspector).getByText('Cancelled')).toBeTruthy()
    expect(within(inspector).getByText('Daily · 09:00')).toBeTruthy()
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(inspector).queryByRole('button', { name: /Pause|Enable/ })).toBeNull()
  })

  it('removes terminal one-off schedules from the table after seven days', async () => {
    const day = 24 * 60 * 60 * 1_000
    const now = Date.now()
    const expiredCompleted = makeSchedule({
      id: 'schedule-expired-completed',
      title: 'Expired completed retry',
      timing: { type: 'once', runAt: now - 7 * day },
      lifecycle: { state: 'completed', completedAt: now - 7 * day },
    })
    const expiredCancelled = makeSchedule({
      id: 'schedule-expired-cancelled',
      title: 'Expired cancelled retry',
      timing: { type: 'once', runAt: now - 7 * day },
      lifecycle: { state: 'cancelled', cancelledAt: now - 7 * day },
    })
    const recentCompleted = makeSchedule({
      id: 'schedule-recent-completed',
      title: 'Recent completed retry',
      timing: { type: 'once', runAt: now - 6 * day },
      lifecycle: { state: 'completed', completedAt: now - 6 * day },
    })
    const oldNonTerminal = makeSchedule({
      id: 'schedule-old-pending',
      title: 'Old pending one-off',
      timing: { type: 'once', runAt: now - 30 * day },
      lifecycle: { state: 'active', enabled: true, nextFireAt: now - 30 * day },
    })
    const recurring = makeSchedule({
      id: 'schedule-recurring-history',
      title: 'Recurring with old history',
      lifecycle: { state: 'active', enabled: true, nextFireAt: Date.UTC(2026, 0, 2, 9), lastFireAt: now - 30 * day },
    })
    mockBackend([expiredCompleted, expiredCancelled, recentCompleted, oldNonTerminal, recurring])

    renderView()

    expect(await screen.findByRole('button', { name: 'Recent completed retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Old pending one-off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Recurring with old history' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expired completed retry' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expired cancelled retry' })).toBeNull()
    expect(screen.getByLabelText('Task Schedule summary').textContent).toMatch(/3\s*Task Schedules/)
  })


  it('refreshes the mounted view when agent-created schedules may have changed', async () => {
    const runAt = Date.UTC(2026, 7, 26, 13, 46)
    const backend = mockBackend([])
    renderView()
    await screen.findByText('No Task Schedules found')

    backend.setSchedules([makeSchedule({
      id: 'schedule-agent',
      title: 'Agent-created retry',
      timing: { type: 'once', runAt },
      lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
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
    expect(screen.getByRole('complementary', { name: 'Task Schedule details' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Close Task Schedule details' }))
    row.focus()
    await fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: 'Task Schedule details' })).toBeTruthy()
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

})
