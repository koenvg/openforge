import { mockTask, findPromptTextbox, resetDialogMocks } from './AddTaskDialog.testFixtures'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createTask } from '../lib/ipc'

async function typePrompt(value: string) {
  await fireEvent.input(await findPromptTextbox(), { target: { value } })
}

function backdrop() {
  return screen.getByRole('dialog', { name: 'Create task' })
}

describe('AddTaskDialog draft retention', () => {
  beforeEach(resetDialogMocks)

  it('ignores a backdrop click once a prompt has been typed', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })
    await typePrompt('Fix the flaky test')

    await fireEvent.click(backdrop())

    expect(onClose).not.toHaveBeenCalled()
  })

  it('dismisses on a backdrop click while the prompt is empty', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })
    await findPromptTextbox()

    await fireEvent.click(backdrop())

    expect(onClose).toHaveBeenCalled()
  })

  it('treats a whitespace-only prompt as empty for backdrop dismissal', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })
    await typePrompt('   ')

    await fireEvent.click(backdrop())

    expect(onClose).toHaveBeenCalled()
  })

  it('keeps dismissing on a backdrop click while editing an existing task', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, onClose } })
    await typePrompt('Edited prompt')

    await fireEvent.click(screen.getByRole('dialog', { name: 'Edit task' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('restores a dismissed prompt when the dialog is opened again', async () => {
    const first = render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })
    await typePrompt('Fix the flaky test')
    first.unmount()

    render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })

    await waitFor(async () => {
      expect((await findPromptTextbox()).value).toBe('Fix the flaky test')
    })
  })

  it('opens empty again after the retained prompt produced a task', async () => {
    const first = render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn(), onTaskCreated: vi.fn() } })
    await typePrompt('Fix the flaky test')
    await fireEvent.click(await screen.findByRole('button', { name: 'Add to backlog' }))
    await waitFor(() => expect(createTask).toHaveBeenCalled())
    first.unmount()

    render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })

    expect((await findPromptTextbox()).value).toBe('')
  })

  it('clears the prompt on Discard and leaves the dialog open', async () => {
    const onClose = vi.fn()
    const first = render(AddTaskDialog, { props: { mode: 'create', onClose } })
    await typePrompt('Fix the flaky test')

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(async () => {
      expect((await findPromptTextbox()).value).toBe('')
    })
    expect(onClose).not.toHaveBeenCalled()

    first.unmount()
    render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })
    expect((await findPromptTextbox()).value).toBe('')
  })

  it('offers Discard only once a prompt exists', async () => {
    render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })
    await findPromptTextbox()

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Discard' }).disabled).toBe(true)

    await typePrompt('Fix the flaky test')

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Discard' }).disabled).toBe(false)
  })

  it('offers no Discard control while editing an existing task', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, onClose: vi.fn() } })
    await findPromptTextbox()

    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
  })

  it('presents a supplied seed instead of a retained prompt', async () => {
    const first = render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })
    await typePrompt('My own draft')
    first.unmount()

    render(AddTaskDialog, { props: { mode: 'create', promptSeed: 'Seeded work', onClose: vi.fn() } })

    expect((await findPromptTextbox()).value).toBe('Seeded work')
  })
})
