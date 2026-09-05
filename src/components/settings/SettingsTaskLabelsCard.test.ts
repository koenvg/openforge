import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsTaskLabelsCard from './SettingsTaskLabelsCard.svelte'
import type { TaskLabel } from '../../lib/types'
import { createTaskLabel, deleteTaskLabel, getProjectTaskLabels } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  createTaskLabel: vi.fn(),
  deleteTaskLabel: vi.fn().mockResolvedValue(undefined),
}))

const bugLabel: TaskLabel = { id: 1, projectId: 'P-1', name: 'bug' }
const docsLabel: TaskLabel = { id: 2, projectId: 'P-1', name: 'docs' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel])
  vi.mocked(createTaskLabel).mockResolvedValue(docsLabel)
  vi.mocked(deleteTaskLabel).mockResolvedValue(undefined)
})

describe('SettingsTaskLabelsCard', () => {
  it('loads and lists project task labels in settings', async () => {
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })

    expect(await screen.findByText('bug')).toBeTruthy()
    expect(getProjectTaskLabels).toHaveBeenCalledWith('P-1')
    expect(screen.getByRole('button', { name: 'Delete task label bug' })).toBeTruthy()
  })

  it('creates project task labels from settings', async () => {
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })

    await screen.findByText('bug')
    await fireEvent.input(screen.getByLabelText('New task label'), { target: { value: 'docs' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add Label' }))

    expect(createTaskLabel).toHaveBeenCalledWith('P-1', 'docs')
    expect(await screen.findByText('docs')).toBeTruthy()
  })

  it('announces duplicate-label validation and allows correction with the keyboard', async () => {
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })
    await screen.findByText('bug')
    const input = screen.getByRole('textbox', { name: 'New task label' })
    await fireEvent.input(input, { target: { value: 'bug' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('Label already exists')
    expect(createTaskLabel).not.toHaveBeenCalled()
    await fireEvent.input(input, { target: { value: 'docs' } })
    expect(screen.queryByRole('alert')).toBeNull()
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(createTaskLabel).toHaveBeenCalledWith('P-1', 'docs')
  })

  it('confirms before deleting project task labels from settings', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })

    await screen.findByText('bug')
    await fireEvent.click(screen.getByRole('button', { name: 'Delete task label bug' }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('bug'))
    expect(deleteTaskLabel).toHaveBeenCalledWith(1)
    await waitFor(() => {
      expect(screen.queryByText('bug')).toBeNull()
    })

    confirmSpy.mockRestore()
  })

  it('keeps labels when deletion is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })

    await screen.findByText('bug')
    await fireEvent.click(screen.getByRole('button', { name: 'Delete task label bug' }))

    expect(deleteTaskLabel).not.toHaveBeenCalled()
    expect(screen.getByText('bug')).toBeTruthy()

    confirmSpy.mockRestore()
  })

  it('uses native disabled semantics and suppresses management actions when disabled', async () => {
    render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: true } })

    await screen.findByText('bug')
    const input = screen.getByLabelText('New task label') as HTMLInputElement
    const addButton = screen.getByRole('button', { name: 'Add Label' }) as HTMLButtonElement
    const deleteButton = screen.getByRole('button', { name: 'Delete task label bug' }) as HTMLButtonElement

    expect(input.disabled).toBe(true)
    expect(addButton.disabled).toBe(true)
    expect(deleteButton.disabled).toBe(true)
  })
})
