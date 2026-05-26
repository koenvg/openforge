import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
import { DEFAULT_HANDOFF_NOTES_TEMPLATE } from '../../lib/handoffNotes'

describe('SettingsInstructionsCard', () => {
  it('renders separate controls for agent instructions and the handoff notes template', () => {
    render(SettingsInstructionsCard, {
      props: {
        agentInstructions: 'Use TDD',
        handoffNotesTemplate: '## Current summary\nCustom template',
        disabled: false,
        onInstructionsChange: vi.fn(),
        onHandoffNotesTemplateChange: vi.fn(),
      },
    })

    expect(screen.getByDisplayValue('Use TDD')).toBeTruthy()
    const label = screen.getByText('Handoff Notes Template').closest('label')
    const textarea = label?.querySelector('textarea')
    expect(textarea?.value).toBe('## Current summary\nCustom template')
    expect(screen.getByText('Handoff Notes Template')).toBeTruthy()
  })

  it('shows the default handoff template as the placeholder when no project override is set', () => {
    render(SettingsInstructionsCard, {
      props: {
        agentInstructions: '',
        handoffNotesTemplate: '',
        disabled: false,
        onInstructionsChange: vi.fn(),
        onHandoffNotesTemplateChange: vi.fn(),
      },
    })

    const label = screen.getByText('Handoff Notes Template').closest('label')
    const textarea = label?.querySelector('textarea')
    expect(textarea?.placeholder).toBe(DEFAULT_HANDOFF_NOTES_TEMPLATE)
  })

  it('clears the project template when reset to default is clicked', async () => {
    const onHandoffNotesTemplateChange = vi.fn()
    render(SettingsInstructionsCard, {
      props: {
        agentInstructions: '',
        handoffNotesTemplate: '## Current summary\nCustom template',
        disabled: false,
        onInstructionsChange: vi.fn(),
        onHandoffNotesTemplateChange,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /reset to default template/i }))

    expect(onHandoffNotesTemplateChange).toHaveBeenCalledWith('')
  })
})
