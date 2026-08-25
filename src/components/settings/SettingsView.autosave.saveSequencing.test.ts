import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { defaultProps, openSettingsCategory } from './SettingsView.testUtils'
import { setupSettingsViewAutosaveSuite } from './SettingsView.autosave.testFixture'
import { setConfig, setProjectConfig, updateProject } from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

setupSettingsViewAutosaveSuite()


describe('SettingsView autosave save sequencing', () => {
  it('communicates autosave, dirty, saving, and saved states', async () => {
    let resolveFirstSave!: () => void
    vi.mocked(updateProject).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    }))

    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(updateProject).mockClear()
    defaultProps.onProjectSettingsSaved.mockClear()

    expect(screen.getByText('Autosaves changes')).toBeTruthy()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'New Name' } })

    expect(screen.getByText('Unsaved changes — autosaving soon…')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(600)
    await vi.waitFor(() => {
      expect(screen.getByText('Saving changes…')).toBeTruthy()
    })

    resolveFirstSave()
    await vi.advanceTimersByTimeAsync(0)

    await vi.waitFor(() => {
      expect(screen.getByText('All changes saved')).toBeTruthy()
      expect(defaultProps.onProjectSettingsSaved).toHaveBeenCalledOnce()
    })
  })

  it('shows autosave errors with a retry action', async () => {
    vi.mocked(updateProject)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)

    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'New Name' } })

    await vi.advanceTimersByTimeAsync(600)

    await vi.waitFor(() => {
      expect(screen.getByText('Autosave failed: disk full')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /retry autosave/i }))

    await vi.waitFor(() => {
      expect(screen.getByText('All changes saved')).toBeTruthy()
    })
  })

  it('keeps newer input while a previous save is still in flight and reruns with the latest value', async () => {
    let resolveFirstSave!: () => void
    vi.mocked(updateProject)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockResolvedValueOnce(undefined)

    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)

    const nameInput = requireElement(screen.getByPlaceholderText('My Project'), HTMLInputElement)
    await fireEvent.input(nameInput, { target: { value: 'First Name' } })

    await vi.advanceTimersByTimeAsync(600)
    await vi.waitFor(() => {
      expect(updateProject).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Saving changes…')).toBeTruthy()
    })

    await fireEvent.input(nameInput, { target: { value: 'Second Name' } })

    expect(nameInput.value).toBe('Second Name')

    resolveFirstSave()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => {
      expect(updateProject).toHaveBeenCalledTimes(2)
    })

    expect(nameInput.value).toBe('Second Name')

    const updatedProject = get(projects).find(p => p.id === 'test-project-id')
    expect(updatedProject?.name).toBe('Second Name')
  })

  it('does not merge a stale project name while a newer save is still in flight', async () => {
    let resolveFirstSave!: () => void
    let resolveSecondSave!: () => void
    vi.mocked(updateProject)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSecondSave = resolve
      }))

    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)

    const nameInput = requireElement(screen.getByPlaceholderText('My Project'), HTMLInputElement)
    await fireEvent.input(nameInput, { target: { value: 'First Name' } })

    await vi.advanceTimersByTimeAsync(600)
    await vi.waitFor(() => {
      expect(updateProject).toHaveBeenCalledTimes(1)
    })

    await fireEvent.input(nameInput, { target: { value: 'Second Name' } })

    resolveFirstSave()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => {
      expect(updateProject).toHaveBeenCalledTimes(2)
    })

    expect(nameInput.value).toBe('Second Name')
    expect(get(projects).find(p => p.id === 'test-project-id')?.name).not.toBe('First Name')

    resolveSecondSave()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => {
      expect(get(projects).find(p => p.id === 'test-project-id')?.name).toBe('Second Name')
    })
  })

  it('does not merge a stale project identity after switching Projects while a newer save is pending', async () => {
    let resolveFirstSave!: () => void
    let resolveSecondSave!: () => void
    vi.mocked(updateProject)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSecondSave = resolve
      }))

    render(SettingsView, { props: defaultProps })
    await vi.advanceTimersByTimeAsync(50)

    const nameInput = requireElement(screen.getByPlaceholderText('My Project'), HTMLInputElement)
    await fireEvent.input(nameInput, { target: { value: 'First Name' } })
    await vi.advanceTimersByTimeAsync(600)
    await vi.waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1))

    await fireEvent.input(nameInput, { target: { value: 'Second Name' } })
    projects.set([
      ...get(projects),
      {
        id: 'project-2',
        name: 'Other Project',
        path: '/tmp/other',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ])
    activeProjectId.set('project-2')

    resolveFirstSave()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(updateProject).toHaveBeenCalledTimes(2))
    expect(get(projects).find(p => p.id === 'test-project-id')?.name).not.toBe('First Name')

    resolveSecondSave()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => {
      expect(get(projects).find(p => p.id === 'test-project-id')?.name).toBe('Second Name')
    })
  })

  it('persists the original settings scope when mode changes before debounce fires', async () => {
    const { rerender } = render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setConfig).mockClear()
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'Renamed Project' } })
    await rerender({ ...defaultProps, mode: 'global' as const })

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(updateProject)).toHaveBeenCalled()
    expect(vi.mocked(setConfig)).not.toHaveBeenCalled()
  })

  it('persists pending global settings when switching to project settings before debounce fires', async () => {
    const { rerender } = render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openSettingsCategory(/GitHub & Credentials/)

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setConfig).mockClear()
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const tokenInput = screen.getByPlaceholderText('ghp_...')
    await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })
    await rerender(defaultProps)

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_new')
    expect(vi.mocked(setProjectConfig)).not.toHaveBeenCalled()
    expect(vi.mocked(updateProject)).not.toHaveBeenCalled()
  })

  it('persists edits from both settings scopes when both change before debounce fires', async () => {
    const { rerender } = render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setConfig).mockClear()
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'Renamed Project' } })
    await rerender({ ...defaultProps, mode: 'global' as const })
    await openSettingsCategory(/GitHub & Credentials/)

    const tokenInput = screen.getByPlaceholderText('ghp_...')
    await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(updateProject)).toHaveBeenCalled()
    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_new')
  })

  it('resets debounce when multiple changes happen quickly', async () => {
    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(setConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')

    await fireEvent.input(nameInput, { target: { value: 'A' } })
    await vi.advanceTimersByTimeAsync(200)
    await fireEvent.input(nameInput, { target: { value: 'AB' } })
    await vi.advanceTimersByTimeAsync(200)
    await fireEvent.input(nameInput, { target: { value: 'ABC' } })

    expect(vi.mocked(updateProject)).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(updateProject)).toHaveBeenCalledTimes(1)
  })
})
