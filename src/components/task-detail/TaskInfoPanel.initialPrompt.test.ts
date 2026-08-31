import { fireEvent, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  baseTask,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'

describe('TaskInfoPanel initial prompt', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('shows the whole initial prompt and hides it through the section header', async () => {
    renderTaskInfoPanel({
      task: {
        ...baseTask,
        prompt: 'Build a calm task attention pane\nShow active signals\nKeep long documents below\nReserve full text for expansion',
      },
    })

    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toContain('Build a calm task attention pane')
    expect(promptContent.textContent).toContain('Reserve full text for expansion')

    await fireEvent.click(screen.getByRole('button', { name: 'Initial Prompt' }))

    expect(screen.queryByRole('region', { name: 'Initial Prompt content' })).toBeNull()
  })

  it('renders prompt as read-only text', () => {
    renderTaskInfoPanel()

    const promptSection = screen.getByLabelText('Initial Prompt').closest('section')
    expect(promptSection?.querySelector('input')).toBeNull()
    expect(promptSection?.querySelector('textarea')).toBeNull()
  })
})
