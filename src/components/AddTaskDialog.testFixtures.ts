import { screen, fireEvent, waitFor } from '@testing-library/svelte'
import { expect, vi } from 'vitest'
import { createTask as createFixtureTask } from '../../storybook/shared/fixtures/appFixtures'
import { createTask, updateTaskInitialPrompt, getProjectConfig, getResolvedAiProvider, listGitBranches, repoHasCommits, listOpenCodeCommands } from '../lib/ipc'
import { clearAllCreateTaskDrafts } from '../lib/createTaskDraftStore'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn(),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return { activeProjectId: writable('test-project-id') }
})

type CreationOptions = NonNullable<Parameters<typeof createTask>[4]>

export const DEFAULT_WORKTREE_OPTIONS = {
  worktreeSource: 'newBranchFromMain',
  worktreeBranch: null,
  title: null,
  sourceTicketUrl: null,
  taskDisplayTitleUpdatesEnabled: false,
  aiProvider: 'claude-code',
} satisfies CreationOptions

export const PROJECT_DIRECTORY_OPTIONS = {
  ...DEFAULT_WORKTREE_OPTIONS,
  worktreeSource: 'disabled',
} satisfies CreationOptions

export const mockTask = createFixtureTask({
  prompt: 'Existing Task',
  promptPreview: 'Existing Task',
  title: 'Existing Task',
  createdAt: 1000,
  updatedAt: 2000,
})

export function resetDialogMocks() {
  vi.clearAllMocks()
  clearAllCreateTaskDrafts()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(createTask).mockReset().mockResolvedValue(createFixtureTask({
    id: 'T-1',
    projectId: 'test-project-id',
    status: 'backlog',
    title: 'New Task',
    prompt: 'New Task',
    promptPreview: 'New Task',
    createdAt: 1000,
    updatedAt: 1000,
  }))
  vi.mocked(updateTaskInitialPrompt).mockReset().mockResolvedValue(undefined)
  vi.mocked(getProjectConfig).mockResolvedValue(null)
  vi.mocked(getResolvedAiProvider).mockResolvedValue('claude-code')
  vi.mocked(listGitBranches).mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ])
  vi.mocked(repoHasCommits).mockResolvedValue(true)
  vi.mocked(listOpenCodeCommands).mockResolvedValue([])
}

export async function findPromptTextbox(): Promise<HTMLTextAreaElement> {
  await waitFor(() => {
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })
  // The optional title is also a textbox, so select the prompt by element type.
  const textarea = screen
    .getAllByRole('textbox')
    .find((element): element is HTMLTextAreaElement => element.tagName === 'TEXTAREA')
  if (!textarea) throw new Error('prompt textarea not found')
  return textarea
}

export async function clickAddToBacklogFromMore() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Add to backlog' }))
}
