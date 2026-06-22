import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSetupDialog from './ProjectSetupDialog.svelte'
import { createProject } from '../../lib/ipc'
import type { Project } from '../../lib/types'

vi.mock('../../lib/ipc', () => ({
  createProject: vi.fn(),
  selectDirectory: vi.fn(),
}))

const createdProject: Project = {
  id: 'proj-new',
  name: 'New Project',
  path: '/workspace/new-project',
  created_at: 1,
  updated_at: 1,
}

describe('ProjectSetupDialog', () => {
  beforeEach(() => {
    vi.mocked(createProject).mockResolvedValue(createdProject)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens as a named Add Project dialog and focuses the project name', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    expect(within(dialog).getByRole('heading', { name: 'Add Project' })).toBeTruthy()

    const nameInput = within(dialog).getByRole('textbox', { name: /project name/i })
    await waitFor(() => {
      expect(document.activeElement).toBe(nameInput)
    })
  })

  it('keeps keyboard focus inside the modal when tabbing between controls', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    const closeButton = within(dialog).getByRole('button', { name: /close add project/i })
    closeButton.focus()

    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true, bubbles: true })

    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /create project/i }))
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

  it('shows validation feedback instead of submitting empty required fields', async () => {
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    await fireEvent.click(within(dialog).getByRole('button', { name: /create project/i }))

    expect(createProject).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert').textContent).toContain('Project name is required')
    expect(within(dialog).getByRole('alert').textContent).toContain('Repository path is required')
  })

  it('announces errors and keeps the dialog open when project creation fails', async () => {
    vi.mocked(createProject).mockRejectedValueOnce(new Error('Repository is already registered'))
    render(ProjectSetupDialog, { onClose: vi.fn(), onProjectCreated: vi.fn() })

    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    await fireEvent.input(within(dialog).getByRole('textbox', { name: /project name/i }), { target: { value: 'New Project' } })
    await fireEvent.input(within(dialog).getByRole('textbox', { name: /local repository path/i }), { target: { value: '/workspace/new-project' } })
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
    await fireEvent.input(within(dialog).getByRole('textbox', { name: /project name/i }), { target: { value: 'New Project' } })
    await fireEvent.input(within(dialog).getByRole('textbox', { name: /local repository path/i }), { target: { value: '/workspace/new-project' } })
    await fireEvent.click(within(dialog).getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(onProjectCreated).toHaveBeenCalledWith(createdProject)
    })
    expect(within(dialog).getByRole('status').textContent).toContain('Project created')
  })
})
