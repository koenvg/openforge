import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { getProjectConfig, getResolvedAiProvider, listGitBranches, listOpenCodeCommands, repoHasCommits } from '../lib/ipc'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return { activeProjectId: writable('test-project-id') }
})

async function findPromptTextbox(): Promise<HTMLTextAreaElement> {
  return await screen.findByRole('textbox', { name: 'What should the agent do?' }) as HTMLTextAreaElement
}

describe('Create Task sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getResolvedAiProvider).mockResolvedValue('claude-code')
    vi.mocked(listGitBranches).mockResolvedValue([
      { name: 'main', is_current: true, is_remote: false },
      { name: 'feature/open-pr', is_current: false, is_remote: false },
    ])
    vi.mocked(repoHasCommits).mockResolvedValue(true)
    vi.mocked(listOpenCodeCommands).mockResolvedValue([])
  })

  it('renders stable primary and backlog actions', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectName: 'Test Project' } })

    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create task' })).toBeTruthy()
    expect(screen.getByText('Test Project')).toBeTruthy()
    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('')
    expect(textbox.maxLength).toBe(10000)
    expect(screen.getByText('0 / 10,000')).toBeTruthy()
    expect(screen.getByText('Be specific about the goal, constraints, and relevant context.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to backlog' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Start task/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
  })

  it('closes with Escape from the prompt', async () => {
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })

    await fireEvent.keyDown(await findPromptTextbox(), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('collapses environment controls behind a semantic summary', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    expect(screen.getByRole('button', { name: 'Edit environment' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Environment summary: Worktree, latest main, default permissions' })).toBeTruthy()
    expect(screen.queryByLabelText('Worktree')).toBeNull()
    expect(screen.queryByLabelText('New branch from latest main')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('keeps optional settings progressively disclosed', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    const titleSection = screen.getByText('Title and source ticket').closest('details')
    const advancedSection = screen.getByText('Advanced settings').closest('details')
    expect(titleSection?.open).toBe(false)
    expect(advancedSection?.open).toBe(false)

    await fireEvent.click(screen.getByText('Title and source ticket'))
    await fireEvent.click(screen.getByText('Advanced settings'))

    expect(titleSection?.open).toBe(true)
    expect(advancedSection?.open).toBe(true)
    expect(screen.getByLabelText('Task title')).toBeTruthy()
    expect(screen.getByLabelText('Source ticket link')).toBeTruthy()
    expect(screen.queryByLabelText('Code cleanup tasks')).toBeNull()
  })

  it('expands environment controls from the Edit action', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    expect(screen.queryByLabelText('Worktree')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Edit environment' }))

    await waitFor(() => expect(screen.getByLabelText('Worktree')).toBeTruthy())
    expect(screen.getByLabelText('New branch from latest main')).toBeTruthy()
  })
})
