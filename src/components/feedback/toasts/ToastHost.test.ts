import { fireEvent, render, screen } from '@testing-library/svelte'
import { get, type Writable } from 'svelte/store'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import ToastHost from './ToastHost.svelte'
import {
  checkpointNotification,
  ciFailureNotification,
  error,
  rateLimitNotification,
  selectedTaskId,
  taskSpawned,
} from '../../../lib/stores'
import type { CheckpointNotification, CiFailureNotification, RateLimitNotification } from '../../../lib/types'

const checkpoint: CheckpointNotification = {
  ticketId: 'task-checkpoint',
  ticketKey: 'PROJ-42',
  sessionId: 'session-1',
  stage: 'implement',
  message: 'Approval needed',
  timestamp: 1,
}

const ciFailure: CiFailureNotification = {
  task_id: 'task-ci',
  pr_id: 42,
  pr_title: 'Fix login bug',
  ci_status: 'failure',
  timestamp: 1,
}

const rateLimit: RateLimitNotification = {
  reset_at: Math.floor(Date.now() / 1000) + 120,
  timestamp: 1,
}

type NotificationValue =
  | string
  | CheckpointNotification
  | CiFailureNotification
  | RateLimitNotification
  | { taskId: string; promptText: string }

type NotificationCase = {
  name: string
  store: Writable<any>
  value: NotificationValue
  message: RegExp
  timeout: number
}

const cases: NotificationCase[] = [
  { name: 'error', store: error, value: 'Something went wrong', message: /Something went wrong/, timeout: 5000 },
  { name: 'checkpoint', store: checkpointNotification, value: checkpoint, message: /Agent needs input on PROJ-42/, timeout: 8000 },
  { name: 'CI failure', store: ciFailureNotification, value: ciFailure, message: /Pipeline failed: Fix login bug/, timeout: 8000 },
  { name: 'task spawned', store: taskSpawned, value: { taskId: 'new-task', promptText: 'Investigate auth' }, message: /New task created: Investigate auth/, timeout: 5000 },
  { name: 'rate limit', store: rateLimitNotification, value: rateLimit, message: /GitHub API rate limited/, timeout: 15000 },
]

function resetStores() {
  error.set(null)
  checkpointNotification.set(null)
  ciFailureNotification.set(null)
  taskSpawned.set(null)
  rateLimitNotification.set(null)
  selectedTaskId.set(null)
}

describe('ToastHost', () => {
  beforeEach(() => {
    resetStores()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetStores()
  })

  it.each(cases)('adapts the $name store and preserves its timeout', async ({ store, value, message, timeout }) => {
    vi.useFakeTimers()
    render(ToastHost)
    store.set(value)
    await vi.runAllTicks()

    expect(screen.getByText(message)).toBeTruthy()
    vi.advanceTimersByTime(timeout - 1)
    expect(get(store)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(get(store)).toBeNull()
  })

  it('gives a replacement visible notification its full timeout', async () => {
    vi.useFakeTimers()
    render(ToastHost)
    error.set('First error')
    await vi.runAllTicks()

    vi.advanceTimersByTime(4000)
    error.set('Replacement error')
    await vi.runAllTicks()
    vi.advanceTimersByTime(4999)
    expect(get(error)).toBe('Replacement error')

    vi.advanceTimersByTime(1)
    expect(get(error)).toBeNull()
  })

  it.each(cases)('dismisses the $name notification by clearing its store', async ({ store, value, message }) => {
    render(ToastHost)
    store.set(value)

    const text = await screen.findByText(message)
    const toast = text.closest('[role="alert"], [role="status"]')
    expect(toast).not.toBeNull()
    const dismiss = toast?.querySelector('button[aria-label="Dismiss notification"]')
    expect(dismiss).not.toBeNull()
    await fireEvent.click(dismiss as HTMLButtonElement)
    expect(get(store)).toBeNull()
  })

  it.each([
    { store: checkpointNotification, value: checkpoint, message: /Agent needs input on PROJ-42/, taskId: 'task-checkpoint' },
    { store: ciFailureNotification, value: ciFailure, message: /Pipeline failed: Fix login bug/, taskId: 'task-ci' },
  ] as Array<{ store: Writable<any>; value: NotificationValue; message: RegExp; taskId: string }>)(
    'navigates from an actionable notification and dismisses it',
    async ({ store, value, message, taskId }) => {
      render(ToastHost)
      store.set(value)

      await fireEvent.click(await screen.findByRole('button', { name: message }))
      expect(get(selectedTaskId)).toBe(taskId)
      expect(get(store)).toBeNull()
    },
  )

  it('renders ordinary notifications at the bottom and attention notifications raised', async () => {
    render(ToastHost)
    error.set('Bottom message')
    checkpointNotification.set(checkpoint)

    expect((await screen.findByText('Bottom message')).closest('[data-position="bottom"]')).not.toBeNull()
    expect((await screen.findByText(/Agent needs input on PROJ-42/)).closest('[data-position="raised"]')).not.toBeNull()
  })
})
