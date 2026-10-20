import { DEFAULT_WORKTREE_OPTIONS, findPromptTextbox, mockTask, resetDialogMocks } from './AddTaskDialog.testFixtures'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createProject } from '../../storybook/shared/fixtures/appFixtures'
import { createTask, getResolvedAiProvider, listGitBranches } from '../lib/ipc'

const projects = [
  createProject({ id: 'test-project-id', name: 'OpenForge', path: '/repo/openforge' }),
  createProject({ id: 'project-docs', name: 'Docs site', path: '/repo/docs' }),
  createProject({ id: 'project-infra', name: 'Infrastructure', path: '/repo/infra' }),
]

function renderCreate(props: Record<string, unknown> = {}) {
  return render(AddTaskDialog, { props: { mode: 'create', projects, onClose: vi.fn(), onTaskCreated: vi.fn(), ...props } })
}

function projectPicker(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Project' })
}

async function pressProjectShortcut(extra: Partial<KeyboardEventInit> = {}) {
  // ⌥ mutates e.key on macOS (⌥P → π), so the shortcut matches the physical key.
  await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'π', code: 'KeyP', metaKey: true, altKey: true, ...extra })
}

async function chooseProject(name: string) {
  await pressProjectShortcut()
  const search = await screen.findByRole('textbox', { name: 'Search options' })
  await fireEvent.input(search, { target: { value: name.slice(0, 2) } })
  await fireEvent.keyDown(search, { key: 'Enter' })
}

describe('AddTaskDialog project picker', () => {
  beforeEach(resetDialogMocks)

  it('defaults to the active project', async () => {
    renderCreate()
    await findPromptTextbox()

    expect(projectPicker().textContent).toContain('OpenForge')
  })

  it('starts on the supplied project instead of the active one', async () => {
    renderCreate({ initialProjectId: 'project-docs' })
    await findPromptTextbox()

    expect(projectPicker().textContent).toContain('Docs site')
  })

  it('opens a focused search on ⌘⌥P that narrows projects as you type', async () => {
    renderCreate()
    await findPromptTextbox()

    await pressProjectShortcut()

    const search = await screen.findByRole('textbox', { name: 'Search options' })
    expect(document.activeElement).toBe(search)
    await fireEvent.input(search, { target: { value: 'inf' } })
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent?.trim())).toEqual(['Infrastructure'])
  })

  it('also opens the search on ⌘⌃⌥P', async () => {
    renderCreate()
    await findPromptTextbox()

    await pressProjectShortcut({ ctrlKey: true })

    expect(await screen.findByRole('textbox', { name: 'Search options' })).toBeTruthy()
  })

  it('creates the task in the chosen project with that project\'s defaults and branches', async () => {
    vi.mocked(getResolvedAiProvider).mockImplementation(async (projectId: string) =>
      projectId === 'project-docs' ? 'codex' : 'claude-code')
    renderCreate()
    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Fix the docs build' } })

    await chooseProject('Docs site')

    await waitFor(() => expect(projectPicker().textContent).toContain('Docs site'))
    await waitFor(() => expect(listGitBranches).toHaveBeenLastCalledWith('/repo/docs'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Add to backlog' }) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Fix the docs build', 'backlog', 'project-docs', 'default', {
        ...DEFAULT_WORKTREE_OPTIONS,
        aiProvider: 'codex',
      })
    })
  })

  it('keeps the typed prompt and custom title when switching projects', async () => {
    renderCreate()
    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Rotate the certificates' } })
    await fireEvent.click(await screen.findByLabelText('Custom title'))
    await fireEvent.input(screen.getByLabelText('Task title'), { target: { value: 'Cert rotation' } })

    await chooseProject('Infrastructure')

    await waitFor(() => expect(projectPicker().textContent).toContain('Infrastructure'))
    expect((await findPromptTextbox()).value).toBe('Rotate the certificates')
    await waitFor(() => expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Cert rotation'))
  })

  it('moves a retained draft to the project it was switched to', async () => {
    const first = renderCreate()
    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Draft for docs' } })
    await chooseProject('Docs site')
    await waitFor(() => expect(projectPicker().textContent).toContain('Docs site'))
    first.unmount()

    const reopenedInOriginal = renderCreate()
    expect((await findPromptTextbox()).value).toBe('')
    reopenedInOriginal.unmount()

    renderCreate({ initialProjectId: 'project-docs' })
    await waitFor(async () => expect((await findPromptTextbox()).value).toBe('Draft for docs'))
  })

  it('shows no project picker while editing an existing task', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, projects, onClose: vi.fn() } })
    await findPromptTextbox()

    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
  })
})
