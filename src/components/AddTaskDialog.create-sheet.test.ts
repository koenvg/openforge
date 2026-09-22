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

  it('lays out environment controls inline with a semantic summary', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    expect(screen.getByRole('group', { name: 'Environment summary: Worktree, latest main, default permissions' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Provider' })).toBeTruthy()
    expect(screen.getByLabelText('Worktree')).toBeTruthy()
    expect(screen.getByLabelText('New branch from latest main')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit environment' })).toBeNull()
  })

  it('shows the permission mode control for Claude Code', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    expect(await screen.findByRole('button', { name: 'Mode' })).toBeTruthy()
  })

  it('lays out title controls without progressive disclosure', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    expect(screen.queryByText('Advanced settings')).toBeNull()
    expect(screen.getByLabelText('Custom title')).toBeTruthy()
    expect(screen.getByLabelText('AI-generated title')).toBeTruthy()
    expect(screen.getByLabelText('Task title')).toBeTruthy()
  })

  it('defaults the title to custom and hides the manual field when AI-generated is chosen', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })
    await findPromptTextbox()

    const custom = screen.getByLabelText('Custom title') as HTMLInputElement
    const ai = screen.getByLabelText('AI-generated title') as HTMLInputElement
    expect(custom.checked).toBe(true)
    expect(ai.checked).toBe(false)
    expect(screen.getByLabelText('Task title')).toBeTruthy()

    await fireEvent.click(ai)

    await waitFor(() => expect(screen.queryByLabelText('Task title')).toBeNull())
    expect(screen.getByText('The agent names this task and keeps it updated as work progresses.')).toBeTruthy()
  })
})
