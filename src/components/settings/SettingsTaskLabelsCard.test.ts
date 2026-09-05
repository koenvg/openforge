import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel])
  vi.mocked(createTaskLabel).mockResolvedValue(docsLabel)
  vi.mocked(deleteTaskLabel).mockResolvedValue(undefined)
})

describe('SettingsTaskLabelsCard', () => {
  it.each([
    { outcome: 'resolve', returnToProject: false },
    { outcome: 'reject', returnToProject: false },
    { outcome: 'resolve', returnToProject: true },
    { outcome: 'reject', returnToProject: true },
  ])('ignores a stale delete $outcome while saving, returnToProject=$returnToProject', async ({ outcome, returnToProject }) => {
    const pending = deferred<void>()
    const currentCreate = deferred<TaskLabel>()
    vi.mocked(deleteTaskLabel).mockReturnValueOnce(pending.promise)
    vi.mocked(createTaskLabel).mockReturnValueOnce(currentCreate.promise)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { rerender } = render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })
    await screen.findByText('bug')
    await fireEvent.click(screen.getByRole('button', { name: 'Delete task label bug' }))
    expect(deleteTaskLabel).toHaveBeenCalledWith(1)
    confirmSpy.mockRestore()

    vi.mocked(getProjectTaskLabels).mockResolvedValue([{ id: 3, projectId: 'P-2', name: 'feature' }])
    await rerender({ projectId: 'P-2', disabled: false })
    await screen.findByText('feature')
    if (returnToProject) {
      vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel])
      await rerender({ projectId: 'P-1', disabled: false })
      await screen.findByText('bug')
    }
    const activeProjectId = returnToProject ? 'P-1' : 'P-2'
    const input = screen.getByLabelText('New task label') as HTMLInputElement
    expect(input.disabled).toBe(false)
    await fireEvent.input(input, { target: { value: 'release' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add Label' }))
    expect(createTaskLabel).toHaveBeenCalledWith(activeProjectId, 'release')
    expect(input.disabled).toBe(true)

    if (outcome === 'resolve') pending.resolve()
    else pending.reject(new Error('Old project delete failed'))
    await pending.promise.catch(() => {})
    await tick()
    await waitFor(() => {
      expect(screen.getByText(returnToProject ? 'bug' : 'feature')).toBeTruthy()
      expect(screen.queryByText(returnToProject ? 'feature' : 'bug')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(input.value).toBe('release')
      expect(input.disabled).toBe(true)
    })

    currentCreate.resolve({ id: 4, projectId: activeProjectId, name: 'release' })
    await screen.findByText('release')
    expect(input.disabled).toBe(false)
  })

  it.each([
    { outcome: 'resolve', saving: false },
    { outcome: 'reject', saving: false },
    { outcome: 'resolve', saving: true },
    { outcome: 'reject', saving: true },
  ])('ignores a stale create $outcome after switching projects, saving=$saving', async ({ outcome, saving }) => {
    const pending = deferred<TaskLabel>()
    vi.mocked(createTaskLabel).mockReturnValueOnce(pending.promise)
    const currentCreate = deferred<TaskLabel>()
    vi.mocked(createTaskLabel).mockReturnValueOnce(currentCreate.promise)
    const { rerender } = render(SettingsTaskLabelsCard, { props: { projectId: 'P-1', disabled: false } })
    await screen.findByText('bug')
    const input = screen.getByLabelText('New task label') as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'docs' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add Label' }))
    expect(input.disabled).toBe(true)

    vi.mocked(getProjectTaskLabels).mockResolvedValue([{ id: 3, projectId: 'P-2', name: 'feature' }])
    await rerender({ projectId: 'P-2', disabled: false })
    await screen.findByText('feature')
    expect(input.disabled).toBe(false)
    await fireEvent.input(input, { target: { value: 'feature' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add Label' }))
    expect(screen.getByRole('alert').textContent).toBe('Label already exists')
    if (saving) {
      await fireEvent.input(input, { target: { value: 'release' } })
      await fireEvent.click(screen.getByRole('button', { name: 'Add Label' }))
      expect(createTaskLabel).toHaveBeenLastCalledWith('P-2', 'release')
      expect(input.disabled).toBe(true)
    }

    if (outcome === 'resolve') pending.resolve(docsLabel)
    else pending.reject(new Error('Old project create failed'))
    await pending.promise.catch(() => {})
    await tick()
    await waitFor(() => {
      expect(screen.queryByText('docs')).toBeNull()
      expect(screen.getByText('feature')).toBeTruthy()
      expect(screen.queryByRole('alert')?.textContent ?? null).toBe(saving ? null : 'Label already exists')
      expect(input.value).toBe(saving ? 'release' : 'feature')
      expect(input.disabled).toBe(saving)
    })
    if (saving) {
      currentCreate.resolve({ id: 4, projectId: 'P-2', name: 'release' })
      await screen.findByText('release')
      expect(input.disabled).toBe(false)
    }
  })

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
