import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createTask, listGitBranches } from '../lib/ipc'
import AppTaskCreationDialogs from './shell/AppTaskCreationDialogs.svelte'
import { useAppTaskCreationController } from '../lib/appTaskCreationController.svelte'
import { requestTaskCompose, settleTaskCompose } from '../lib/taskCompose'
import { clearAllCreateTaskDrafts, readCreateTaskDraft, writeCreateTaskDraft } from '../lib/createTaskDraftStore'

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn(() => ({ update() {}, destroy() {} })),
}))

vi.mock('../lib/ipc', async () => {
  const { createTask: createFixtureTask } = await import('../../storybook/shared/fixtures/appFixtures')
  return {
    createTask: vi.fn().mockResolvedValue(createFixtureTask({
      id: 'T-1',
      prompt: 'Implement GitHub issue #412',
      promptPreview: 'Implement GitHub issue #412',
      status: 'backlog',
      projectId: 'test-project-id',
      createdAt: 1000,
      updatedAt: 1000,
    })),
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
  }
})

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
  clearAllCreateTaskDrafts()
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(listGitBranches).mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ])
})

describe('AddTaskDialog handoff', () => {
  it.each(['start', 'backlog'] as const)('settles a composed %s before pending work and preserves newer requests', async (intent) => {
    let finish!: () => void
    const runAction = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const navigateToTask = vi.fn()
    const controller = useAppTaskCreationController({
      getTasks: () => [], loadTasks: () => new Promise(() => {}),
      publishTask: vi.fn(), reportError: vi.fn(),
      resetToBoard: vi.fn(), navigateToTask, runAction,
    })
    const pending = requestTaskCompose({ projectId: 'test-project-id', initialPrompt: SEED })
    const settled = vi.fn()
    void pending.then(settled)
    const { unmount } = render(AppTaskCreationDialogs, { props: { controller, projectPath: null, projectName: null } })
    try {
      const button = await screen.findByRole('button', { name: intent === 'start' ? /start task/i : /add to backlog/i })
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
      await fireEvent.click(button)
      await expect(pending).resolves.toMatchObject({ task: { id: 'T-1' }, started: intent === 'start' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(settled).toHaveBeenCalledOnce()
      expect(createTask).toHaveBeenCalledOnce()
      expect(navigateToTask).toHaveBeenCalledTimes(intent === 'start' ? 1 : 0)
      const next = requestTaskCompose({ projectId: 'test-project-id', initialPrompt: 'Next request' })
      const nextSettled = vi.fn()
      void next.then(nextSettled)
      if (intent === 'start') finish()
      await waitFor(() => expect(promptTextarea()?.value).toBe('Next request'))
      expect(nextSettled).not.toHaveBeenCalled()
    } finally {
      unmount()
      settleTaskCompose(null)
    }
  })
})

describe('AddTaskDialog compose over a retained draft', () => {
  it('presents the composed seed and leaves the retained draft untouched', async () => {
    writeCreateTaskDraft('test-project-id', { prompt: 'My own unfinished draft', images: [] })
    const controller = useAppTaskCreationController({
      getTasks: () => [], loadTasks: async () => {},
      publishTask: vi.fn(), reportError: vi.fn(),
      resetToBoard: vi.fn(), navigateToTask: vi.fn(), runAction: async () => {},
    })
    const pending = requestTaskCompose({ projectId: 'test-project-id', initialPrompt: SEED })
    void pending.catch(() => {})
    const { unmount } = render(AppTaskCreationDialogs, { props: { controller, projectPath: null, projectName: null } })
    try {
      await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
      expect(readCreateTaskDraft('test-project-id')?.prompt).toBe('My own unfinished draft')
    } finally {
      unmount()
      settleTaskCompose(null)
    }
  })
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
        onTaskCreated: vi.fn(),
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
      props: { mode: 'create', promptSeed: SEED, titleSeed: 'Login redirect', onTaskCreated: vi.fn() },
    })

    await waitFor(() => expect(promptTextarea()?.value).toBe(SEED))
    await clickAddToBacklog()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][4]).toMatchObject({ title: 'Login redirect' })
  })

  it.each(['start', 'backlog'] as const)('reports the saved task with %s intent', async (intent) => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', promptSeed: SEED, onTaskCreated } })
    const button = await screen.findByRole('button', { name: intent === 'start' ? /start task/i : /add to backlog/i })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    await fireEvent.click(button)
    await waitFor(() => expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), intent))
  })

  it('selects an existing local branch when worktree seeds name it', async () => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        promptSeed: SEED,
        worktreeSourceSeed: 'existingBranch',
        worktreeBranchSeed: 'feature/open-pr',
        onTaskCreated,
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
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        promptSeed: SEED,
        worktreeSourceSeed: 'existingBranch',
        worktreeBranchSeed: 'fix/auth',
        onTaskCreated,
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
