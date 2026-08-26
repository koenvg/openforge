import { render, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'
import { createTask } from './App.test-fixtures/tasks'

function latestDialogProps(mockComponent: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  for (const call of [...mockComponent.mock.calls].reverse()) {
    const props = call.find(
      (arg): arg is Record<string, unknown> => typeof arg === 'object' && arg !== null && 'promptSeed' in arg,
    )
    if (props) return props
  }
  throw new Error('Expected AddTaskDialog to be rendered with a promptSeed')
}

const task = createTask({ id: 'T-9' })

describe('App compose dialog', () => {
  installAppTestLifecycle()

  beforeEach(async () => {
    vi.clearAllMocks()
    const { settleTaskCompose } = await import('./lib/taskCompose')
    settleTaskCompose(null)
  })

  it('opens the create dialog seeded from a compose request', async () => {
    const App = (await import('./App.svelte')).default
    const AddTaskDialog = (await import('./components/AddTaskDialog.svelte')).default
    const { requestTaskCompose } = await import('./lib/taskCompose')
    render(App)

    void requestTaskCompose({
      projectId: 'P-1',
      initialPrompt: 'Implement GitHub issue #412',
      sourceTicketUrl: 'https://github.com/me/app/issues/412',
      title: 'Login redirect',
    })

    await waitFor(() => {
      const props = latestDialogProps(AddTaskDialog as never)
      expect(props.mode).toBe('create')
      expect(props.promptSeed).toBe('Implement GitHub issue #412')
      expect(props.sourceTicketUrlSeed).toBe('https://github.com/me/app/issues/412')
      expect(props.titleSeed).toBe('Login redirect')
    })
  })

  it('resolves the compose request as cancelled when the dialog closes', async () => {
    const App = (await import('./App.svelte')).default
    const AddTaskDialog = (await import('./components/AddTaskDialog.svelte')).default
    const { requestTaskCompose } = await import('./lib/taskCompose')
    render(App)

    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Seed' })
    await waitFor(() => latestDialogProps(AddTaskDialog as never))

    const props = latestDialogProps(AddTaskDialog as never)
    ;(props.onClose as () => void)()

    await expect(pending).resolves.toBeNull()
  })

  it('resolves with the saved task and whether it started', async () => {
    const App = (await import('./App.svelte')).default
    const AddTaskDialog = (await import('./components/AddTaskDialog.svelte')).default
    const { requestTaskCompose } = await import('./lib/taskCompose')
    render(App)

    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Seed' })
    await waitFor(() => latestDialogProps(AddTaskDialog as never))

    const props = latestDialogProps(AddTaskDialog as never)
    await (props.onTaskSaved as (task: Task, options: { started: boolean }) => Promise<void>)(task, {
      started: true,
    })

    await expect(pending).resolves.toEqual({ task, started: true })
  })
})
