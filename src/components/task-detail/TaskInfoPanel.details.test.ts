import { fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentSession } from './agentSession.testFixtures'
import {
  baseTask,
  createPullRequest,
  getTaskInfoPanelTestDependencies,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'

const {
  activeSessions,
  ticketPrs,
  updateTaskSourceTicketUrl,
  writeClipboardText,
} = getTaskInfoPanelTestDependencies()

describe('TaskInfoPanel details', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('lets a source ticket link be added after creation and persists it through the typed IPC wrapper', async () => {
    renderTaskInfoPanel()

    await fireEvent.click(screen.getByRole('button', { name: 'Add source ticket link' }))
    await fireEvent.input(screen.getByLabelText('Source ticket link'), {
      target: { value: 'https://github.com/koenvg/openforge/issues/1294' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateTaskSourceTicketUrl).toHaveBeenCalledWith(
        'T-42',
        'https://github.com/koenvg/openforge/issues/1294',
      )
    })
  })

  it('shows a copyable resume command when the active session can be resumed', () => {
    activeSessions.set(new Map([
      ['T-42', createAgentSession({
        id: 'session-1',
        ticket_id: 'T-42',
        provider: 'pi',
        pi_session_id: 'pi-sess-abc123',
      })],
    ]))

    renderTaskInfoPanel({ workspacePath: '/repo/T-42' })

    expect(screen.getByText('Resume command')).toBeTruthy()
    expect(screen.getByText('pi --session pi-sess-abc123')).toBeTruthy()
    expect(screen.getByTitle('Copy resume command')).toBeTruthy()
  })

  it('hides the resume command row when no active session command is available', () => {
    activeSessions.set(new Map([
      ['T-42', createAgentSession({
        id: 'session-1',
        ticket_id: 'T-42',
        provider: 'codex',
        pi_session_id: null,
      })],
    ]))

    renderTaskInfoPanel({ workspacePath: '/repo/T-42' })

    expect(screen.queryByText('Resume command')).toBeNull()
    expect(screen.queryByText(/--session|--resume|codex resume/)).toBeNull()
  })

  it('copies the workspace path through the typed IPC clipboard wrapper', async () => {
    renderTaskInfoPanel({ workspacePath: '/repo/T-42' })

    await fireEvent.click(screen.getByTitle('Copy workspace path'))

    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('/repo/T-42')
    })
  })

  it('does not show Edit Task or Delete buttons', () => {
    renderTaskInfoPanel()

    expect(screen.queryByText('Edit Task')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('omits status and pull request counts from the details section', () => {
    ticketPrs.set(new Map([['T-42', [createPullRequest()]]]))

    renderTaskInfoPanel()

    const detailsSection = screen.getByLabelText('Details')
    expect(detailsSection.textContent).not.toContain('Status')
    expect(detailsSection.textContent).not.toContain('Pull requests')
    expect(detailsSection.textContent).not.toContain('backlog')
  })

  it('renders workspace path section when workspacePath is provided', () => {
    renderTaskInfoPanel({ workspacePath: '/home/user/worktrees/T-42' })

    expect(screen.getByText('Workspace')).toBeTruthy()
    expect(screen.getByText('/home/user/worktrees/T-42')).toBeTruthy()
  })

  it('does not render workspace section when workspacePath is null', () => {
    renderTaskInfoPanel()

    expect(screen.queryByText('// WORKSPACE')).toBeNull()
  })

  it('collapses the Details section when its header is clicked, hiding its content', async () => {
    renderTaskInfoPanel({ workspacePath: '/repo/T-42' })

    expect(screen.getByText('Workspace')).toBeTruthy()
    const detailsToggle = within(screen.getByLabelText('Details')).getByRole('button', { name: 'Details' })
    await fireEvent.click(detailsToggle)

    expect(screen.queryByText('Workspace')).toBeNull()
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a collapsed section collapsed across remounts and other tasks (global state)', async () => {
    const view = renderTaskInfoPanel({ workspacePath: '/repo/T-42' })
    await fireEvent.click(within(screen.getByLabelText('Details')).getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Workspace')).toBeNull()
    view.unmount()

    renderTaskInfoPanel({ task: { ...baseTask, id: 'T-99' }, workspacePath: '/repo/T-99' })
    expect(screen.queryByText('Workspace')).toBeNull()
  })
})
