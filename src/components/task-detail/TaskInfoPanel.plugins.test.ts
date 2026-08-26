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

  it('hosts task UI sections after the prompt and the source ticket, and before Details', async () => {
    registerTaskUiSectionPlugin()

    renderTaskInfoPanel()

    const section = await screen.findByTestId('plugin-slot-view')
    const prompt = requireElement(document.querySelector('[data-task-info-card="initial-prompt"]'), HTMLElement)
    const sourceTicket = requireElement(screen.getByLabelText('Source ticket'), HTMLElement)
    const details = requireElement(document.querySelector('[data-task-info-card="details"]'), HTMLElement)
    // Chronological order: the prompt that started the task, the ticket it came from,
    // then whatever the plugins link to it. Details is reference material and goes last.
    expect(Boolean(prompt.compareDocumentPosition(sourceTicket) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(sourceTicket.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(section.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('splits plugin sections around the local changes by their declared order', async () => {
    // A linked ticket belongs with the work that started the task; the pull requests that
    // came out of it belong after the changes on disk. Both arrive through the same slot,
    // so the order a plugin declares decides which side of Changes it lands on.
    registerTaskUiSectionPlugin('plugin.task-context', [
      { id: 'linked-issue', order: 30 },
      { id: 'pull-requests', order: 60 },
    ])

    renderTaskInfoPanel({ workspacePath: '/tmp/worktree' })

    const [linkedIssue, pullRequests] = await screen.findAllByTestId('plugin-slot-view')
    const changes = requireElement(document.querySelector('[data-task-info-card="git-status"]'), HTMLElement)
    expect(Boolean(linkedIssue.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(changes.compareDocumentPosition(pullRequests) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('passes action-palette merge progress into task UI sections', async () => {
    registerTaskUiSectionPlugin()
    mergingTaskIds.set(new Set([baseTask.id]))

    renderTaskInfoPanel()

    expect((await screen.findByTestId('plugin-slot-view')).getAttribute('data-task-action-pending')).toBe('true')
  })
})
