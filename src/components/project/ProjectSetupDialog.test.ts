import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSetupDialog from './ProjectSetupDialog.svelte'
import { createProject, selectDirectory } from '../../lib/ipc'
import type { Project } from '../../lib/types'

vi.mock('../../lib/ipc', () => ({
  createProject: vi.fn(),
  selectDirectory: vi.fn(),
}))

const createdProject: Project = {
  id: 'proj-new',
  name: 'new-project',
  path: '/workspace/new-project',
  created_at: 1,
  updated_at: 1,
}

const REPO_PATH = '/Users/you/workspace/my-project'

function selectRepository(dialog: HTMLElement) {
  return fireEvent.click(within(dialog).getByRole('button', { name: /select repository/i }))
}

function nameInput(dialog: HTMLElement) {
  return within(dialog).getByRole('textbox', { name: /project name/i }) as HTMLInputElement
}

describe('ProjectSetupDialog', () => {
  beforeEach(() => {
    vi.mocked(createProject).mockResolvedValue(createdProject)
    vi.mocked(selectDirectory).mockResolvedValue(REPO_PATH)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens as a named Add Project dialog focused on the repository picker', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    expect(within(dialog).getByRole('heading', { name: 'Add Project' })).toBeTruthy()

    const picker = within(dialog).getByRole('button', { name: /select repository/i })
    await waitFor(() => {
      expect(document.activeElement).toBe(picker)
    })
  })

  it('closes without creating when Escape or Cancel is used', async () => {
    const onClose = vi.fn()
    render(ProjectSetupDialog, { onClose, onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    await fireEvent.keyDown(dialog, { key: 'Escape', bubbles: true })
    await fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(2)
    expect(createProject).not.toHaveBeenCalled()
  })

  it('auto-fills the project name from the selected repository folder', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: 'Add Project' })

    await selectRepository(dialog)

    await waitFor(() => expect(nameInput(dialog).value).toBe('my-project'))
  })

  it('keeps the Create button disabled until a repository is selected', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: 'Add Project' })

    const createButton = within(dialog).getByRole('button', { name: /create project/i }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    await selectRepository(dialog)

    await waitFor(() => expect(createButton.disabled).toBe(false))
  })

  it('does not overwrite a manually edited name when a different repository is selected', async () => {
    vi.mocked(selectDirectory)
      .mockResolvedValueOnce(REPO_PATH)
      .mockResolvedValueOnce('/Users/you/workspace/other-repo')
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: 'Add Project' })

    await selectRepository(dialog)
    await waitFor(() => expect(nameInput(dialog).value).toBe('my-project'))

    await fireEvent.input(nameInput(dialog), { target: { value: 'Custom Name' } })
    await fireEvent.click(within(dialog).getByRole('button', { name: /change/i }))

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledTimes(2))
    expect(nameInput(dialog).value).toBe('Custom Name')
  })

  it('re-derives the name from a newly selected repository after the name is cleared', async () => {
    vi.mocked(selectDirectory)
      .mockResolvedValueOnce(REPO_PATH)
      .mockResolvedValueOnce('/Users/you/workspace/other-repo')
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })
    const dialog = screen.getByRole('dialog', { name: 'Add Project' })

    await selectRepository(dialog)
    await waitFor(() => expect(nameInput(dialog).value).toBe('my-project'))

    await fireEvent.input(nameInput(dialog), { target: { value: '' } })
    await fireEvent.click(within(dialog).getByRole('button', { name: /change/i }))

    await waitFor(() => expect(nameInput(dialog).value).toBe('other-repo'))
  })

  it('announces errors and keeps the dialog open when project creation fails', async () => {
    vi.mocked(createProject).mockRejectedValueOnce(new Error('Repository is already registered'))
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    await selectRepository(dialog)
    await waitFor(() => expect(nameInput(dialog).value).toBe('my-project'))
    await fireEvent.click(within(dialog).getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(within(dialog).getByRole('alert').textContent).toContain('Repository is already registered')
    })
    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeTruthy()
  })

  it('announces success and reports the created project', async () => {
    const onProjectCreated = vi.fn()
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    await selectRepository(dialog)
    await waitFor(() => expect(nameInput(dialog).value).toBe('my-project'))
    await fireEvent.click(within(dialog).getByRole('button', { name: /create project/i }))

    await waitFor(() => expect(createProject).toHaveBeenCalledWith('my-project', REPO_PATH))
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(createdProject), { timeout: 2000 })
    expect(within(dialog).getByRole('status').textContent).toContain('Project created')
  })
})
