import { findPromptTextbox, resetDialogMocks } from './AddTaskDialog.testFixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listOpenCodeCommands } from '../lib/ipc'
import AddTaskDialog from './AddTaskDialog.svelte'

describe('AddTaskDialog Escape ownership', () => {
  beforeEach(resetDialogMocks)

  it('closes zero-result autocomplete before closing the dialog', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })

    const prompt = await findPromptTextbox()
    await fireEvent.input(prompt, { target: { value: '/' } })
    await waitFor(() => expect(listOpenCodeCommands).toHaveBeenCalledOnce())
    expect(screen.queryByRole('listbox')).toBeNull()

    await fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    await fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
