import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createTask, listGitBranches } from '../lib/ipc'

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn(() => ({ update() {}, destroy() {} })),
}))

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    initial_prompt: 'Implement GitHub issue #412',
    status: 'backlog',
    prompt: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    depends_on: [],
    project_id: 'test-project-id',
    created_at: 1000,
    updated_at: 1000,
  }),
  updateTaskInitialPrompt: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([]),
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

const SEED = 'Implement GitHub issue #412: Login redirect drops the query'

const promptTextarea = () => document.querySelector<HTMLTextAreaElement>('textarea')

/** Creating without starting is the dialog's secondary footer action. */
async function clickAddToBacklog(): Promise<void> {
  await fireEvent.click(await screen.findByRole('button', { name: /add to backlog/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(listGitBranches).mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ])
})

describe('AddTaskDialog seeding', () => {
  it('pre-fills the prompt from promptSeed in create mode', async () => {
    render(AddTaskDialog, { props: { mode: 'create', promptSeed: SEED } })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
  })

  it('leaves the prompt empty when no seed is given', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await waitFor(() => expect(promptTextarea()).not.toBeNull())
    expect(promptTextarea()?.value).toBe('')
  })

  it('passes the seeded source ticket url through to createTask', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        promptSeed: SEED,
        sourceTicketUrlSeed: 'https://github.com/me/app/issues/412',
        onTaskSaved: vi.fn(),
      },
    })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
    await clickAddToBacklog()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][4]).toMatchObject({
      sourceTicketUrl: 'https://github.com/me/app/issues/412',
    })
  })

  it('passes the seeded title through to createTask', async () => {
    render(AddTaskDialog, {
      props: { mode: 'create', promptSeed: SEED, titleSeed: 'Login redirect', onTaskSaved: vi.fn() },
    })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
    await clickAddToBacklog()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][4]).toMatchObject({ title: 'Login redirect' })
  })

  it('reports started false when the task is only created', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', promptSeed: SEED, onTaskSaved } })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
    await clickAddToBacklog()

    await waitFor(() => expect(onTaskSaved).toHaveBeenCalled())
    expect(onTaskSaved.mock.calls[0][0]).toMatchObject({ id: 'T-1' })
    expect(onTaskSaved.mock.calls[0][1]).toEqual({ started: false })
  })

  it('reports started true when the task is created and started', async () => {
    const onTaskSaved = vi.fn()
    const onRunAction = vi.fn().mockResolvedValue(undefined)
    render(AddTaskDialog, {
      props: { mode: 'create', promptSeed: SEED, onTaskSaved, onRunAction },
    })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
    await fireEvent.click(await screen.findByRole('button', { name: /start task/i }))

    await waitFor(() => expect(onRunAction).toHaveBeenCalled())
    expect(onTaskSaved.mock.calls[0][1]).toEqual({ started: true })
  })

  it('selects an existing local branch when worktree seeds name it', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        promptSeed: SEED,
        worktreeSourceSeed: 'existingBranch',
        worktreeBranchSeed: 'feature/open-pr',
        onTaskSaved,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('group', {
        name: 'Environment summary: Worktree, feature/open-pr, default permissions',
      })).toBeTruthy()
    })

    await clickAddToBacklog()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][4]).toMatchObject({
      worktreeSource: 'existingBranch',
      worktreeBranch: 'feature/open-pr',
    })
  })

  it('maps a pull-request head ref onto origin/<name> when both exist', async () => {
    vi.mocked(listGitBranches).mockResolvedValue([
      { name: 'main', is_current: true, is_remote: false },
      { name: 'fix/auth', is_current: false, is_remote: false },
      { name: 'origin/fix/auth', is_current: false, is_remote: true },
    ])
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        promptSeed: SEED,
        worktreeSourceSeed: 'existingBranch',
        worktreeBranchSeed: 'fix/auth',
        onTaskSaved,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('group', {
        name: 'Environment summary: Worktree, origin/fix/auth, default permissions',
      })).toBeTruthy()
    })

    await clickAddToBacklog()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][4]).toMatchObject({
      worktreeSource: 'existingBranch',
      worktreeBranch: 'origin/fix/auth',
    })
  })
})
