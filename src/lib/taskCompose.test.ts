import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { pendingComposeRequest, requestTaskCompose, settleTaskCompose } from './taskCompose'
import { createTask } from '../App.test-fixtures/tasks'

const task = createTask({ id: 'T-1' })

beforeEach(() => settleTaskCompose(null))

describe('taskCompose', () => {
  it('publishes the request while one is in flight', () => {
    void requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Implement issue #4' })

    expect(get(pendingComposeRequest)?.request.initialPrompt).toBe('Implement issue #4')
  })

  it('resolves with the result and clears the pending request', async () => {
    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Implement issue #4' })

    settleTaskCompose({ task, started: true })

    await expect(pending).resolves.toEqual({ task, started: true })
    expect(get(pendingComposeRequest)).toBeNull()
  })

  it('resolves null when the dialog is dismissed', async () => {
    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Implement issue #4' })

    settleTaskCompose(null)

    await expect(pending).resolves.toBeNull()
  })

  it('settles only once, so a close after a save does not overwrite the result', async () => {
    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Implement issue #4' })

    settleTaskCompose({ task, started: true })
    settleTaskCompose(null)

    await expect(pending).resolves.toEqual({ task, started: true })
  })

  it('settles the previous request as cancelled when a second one arrives', async () => {
    const first = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'First' })
    const second = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Second' })

    await expect(first).resolves.toBeNull()
    expect(get(pendingComposeRequest)?.request.initialPrompt).toBe('Second')

    settleTaskCompose({ task, started: false })
    await expect(second).resolves.toEqual({ task, started: false })
  })
})
