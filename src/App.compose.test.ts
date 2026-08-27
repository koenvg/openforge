import { render, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import { installAppTestLifecycle } from './App.test-harness'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { createTask } from './App.test-fixtures/tasks'

type ComposeDialogProps = ComponentProps<
  typeof import('./components/AddTaskDialog.svelte').default
>

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
      const props = getLatestComponentProps<ComposeDialogProps>(
        vi.mocked(AddTaskDialog),
        'promptSeed',
      )
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
    const props = await waitFor(() =>
      getLatestComponentProps<ComposeDialogProps>(vi.mocked(AddTaskDialog), 'promptSeed'),
    )
    props.onClose()

    await expect(pending).resolves.toBeNull()
  })

  it('resolves with the saved task and whether it started', async () => {
    const App = (await import('./App.svelte')).default
    const AddTaskDialog = (await import('./components/AddTaskDialog.svelte')).default
    const { requestTaskCompose } = await import('./lib/taskCompose')
    render(App)

    const pending = requestTaskCompose({ projectId: 'P-1', initialPrompt: 'Seed' })
    const props = await waitFor(() =>
      getLatestComponentProps<ComposeDialogProps>(vi.mocked(AddTaskDialog), 'promptSeed'),
    )
    await props.onTaskSaved(task, {
      started: true,
    })

    await expect(pending).resolves.toEqual({ task, started: true })
  })
})
