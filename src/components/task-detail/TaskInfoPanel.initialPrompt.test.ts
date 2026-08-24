import { fireEvent, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  baseTask,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'

describe('TaskInfoPanel initial prompt', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('previews the initial prompt by default and reveals the full prompt on request', async () => {
    renderTaskInfoPanel({
      task: {
        ...baseTask,
        initial_prompt: 'Build a calm task attention pane\nShow active signals\nKeep long documents below\nReserve full text for expansion',
      },
    })

    expect(screen.getByText('Initial Prompt')).toBeTruthy()
    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toContain('Build a calm task attention pane')
    expect(promptContent.textContent).toContain('Keep long documents below')
    expect(promptContent.textContent).not.toContain('Reserve full text for expansion')

    await fireEvent.click(screen.getByRole('button', { name: /show full initial prompt/i }))

    expect(promptContent.textContent).toContain('Reserve full text for expansion')
  })

  it('renders prompt as read-only text', () => {
    renderTaskInfoPanel()

    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.querySelector('input')).toBeNull()
    expect(promptSection?.querySelector('textarea')).toBeNull()
  })
})
