import { screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import {
  baseTask,
  getTaskInfoPanelTestDependencies,
  registerTaskUiSectionPlugin,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'

const { mergingTaskIds } = getTaskInfoPanelTestDependencies()

describe('TaskInfoPanel plugin sections', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('hosts task UI sections after the source ticket and before the built-in Initial Prompt card', async () => {
    registerTaskUiSectionPlugin()

    renderTaskInfoPanel()

    const section = await screen.findByTestId('plugin-slot-view')
    const sourceTicket = requireElement(screen.getByLabelText('Source ticket'), HTMLElement)
    const prompt = requireElement(document.querySelector('[data-task-info-card="initial-prompt"]'), HTMLElement)
    expect(Boolean(sourceTicket.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(section.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('passes action-palette merge progress into task UI sections', async () => {
    registerTaskUiSectionPlugin()
    mergingTaskIds.set(new Set([baseTask.id]))

    renderTaskInfoPanel()

    expect((await screen.findByTestId('plugin-slot-view')).getAttribute('data-task-action-pending')).toBe('true')
  })
})
