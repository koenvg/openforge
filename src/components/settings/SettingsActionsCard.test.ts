import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { Action } from '../../lib/types'
import SettingsActionsCard from './SettingsActionsCard.svelte'

const actions: Action[] = [
  { id: 'builtin-go', name: 'Go', prompt: 'Implement the task', builtin: true, enabled: true },
]

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    actions,
    disabled: false,
    onAddAction: vi.fn(),
    onDeleteAction: vi.fn(),
    onToggleAction: vi.fn(),
    onUpdateAction: vi.fn(),
    onResetActions: vi.fn(),
    ...overrides,
  }
}

describe('SettingsActionsCard', () => {
  it('renders action controls', () => {
    render(SettingsActionsCard, { props: defaultProps() })

    expect(screen.getByText('Actions')).toBeTruthy()
    expect(screen.getByDisplayValue('Go')).toBeTruthy()
    expect(screen.getByDisplayValue('Implement the task')).toBeTruthy()
  })

  it('uses native disabled semantics and suppresses actions when disabled', async () => {
    const onAddAction = vi.fn()
    const onDeleteAction = vi.fn()
    const onToggleAction = vi.fn()
    const onUpdateAction = vi.fn()
    const onResetActions = vi.fn()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    render(SettingsActionsCard, {
      props: defaultProps({
        disabled: true,
        onAddAction,
        onDeleteAction,
        onToggleAction,
        onUpdateAction,
        onResetActions,
      }),
    })

    const addButton = screen.getByRole('button', { name: /add action/i }) as HTMLButtonElement
    const enabledCheckbox = screen.getByLabelText('Go') as HTMLInputElement
    const deleteButton = screen.getByTitle('Delete action') as HTMLButtonElement
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement
    const resetButton = screen.getByRole('button', { name: /reset to defaults/i }) as HTMLButtonElement

    expect(addButton.disabled).toBe(true)
    expect(enabledCheckbox.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
    expect(nameInput.disabled).toBe(true)
    expect(promptInput.disabled).toBe(true)
    expect(resetButton.disabled).toBe(true)

    await fireEvent.click(addButton)
    await fireEvent.click(enabledCheckbox)
    await fireEvent.click(deleteButton)
    await fireEvent.input(nameInput, { target: { value: 'Changed' } })
    await fireEvent.input(promptInput, { target: { value: 'Changed prompt' } })
    await fireEvent.click(resetButton)

    expect(onAddAction).not.toHaveBeenCalled()
    expect(onDeleteAction).not.toHaveBeenCalled()
    expect(onToggleAction).not.toHaveBeenCalled()
    expect(onUpdateAction).not.toHaveBeenCalled()
    expect(onResetActions).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})
