import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'

describe('SettingsInstructionsCard', () => {
  it('edits project agent instructions', async () => {
    const onInstructionsChange = vi.fn()
    render(SettingsInstructionsCard, {
      props: {
        agentInstructions: 'Use TDD',
        disabled: false,
        onInstructionsChange,
      },
    })

    const instructions = screen.getByLabelText('Instructions')
    expect((instructions as HTMLTextAreaElement).value).toBe('Use TDD')
    await fireEvent.input(instructions, { target: { value: 'Use integration tests' } })
    expect(onInstructionsChange).toHaveBeenCalledWith('Use integration tests')
  })

  it('uses native disabled semantics when project settings are unavailable', async () => {
    const onInstructionsChange = vi.fn()
    render(SettingsInstructionsCard, {
      props: {
        agentInstructions: 'Use TDD',
        disabled: true,
        onInstructionsChange,
      },
    })

    const instructions = screen.getByLabelText('Instructions') as HTMLTextAreaElement
    expect(instructions.disabled).toBe(true)
    await fireEvent.input(instructions, { target: { value: 'Changed' } })
    expect(onInstructionsChange).not.toHaveBeenCalled()
  })
})
