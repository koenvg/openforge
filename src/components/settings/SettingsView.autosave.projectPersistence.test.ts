import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { defaultProps, openSettingsCategory } from './SettingsView.testUtils'
import { setupSettingsViewAutosaveSuite } from './SettingsView.autosave.testFixture'
import {
  checkClaudeInstalled,
  checkPiInstalled,
  getConfig,
  getProjectConfig,
  setConfig,
  setProjectConfig,
  updateProject,
} from '../../lib/ipc'
import { projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

setupSettingsViewAutosaveSuite()


describe('SettingsView autosave project persistence', () => {
  it('refreshes provider installation status from the recovery warning', async () => {
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) => {
      if (key === 'ai_provider') return 'pi'
      return null
    })
    vi.mocked(checkPiInstalled)
      .mockResolvedValueOnce({ installed: false, path: null, version: null })
      .mockResolvedValueOnce({ installed: true, path: '/usr/local/bin/pi', version: '2.0.0' })

    render(SettingsView, { props: defaultProps })
    await openSettingsCategory(/Agents & tasks/)

    await vi.waitFor(() => {
      expect(screen.getByText('Pi Coding Agent is not installed')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /refresh install status/i }))

    await vi.waitFor(() => {
      expect(screen.getByText('Pi 2.0.0')).toBeTruthy()
    })
    expect(screen.queryByText('Pi Coding Agent is not installed')).toBeNull()
  })

  it('switches to an installed provider from provider recovery', async () => {
    vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) => {
      if (key === 'ai_provider') return 'pi'
      return null
    })
    vi.mocked(checkClaudeInstalled).mockResolvedValue({
      installed: true,
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      authenticated: true,
    })

    render(SettingsView, { props: defaultProps })
    await openSettingsCategory(/Agents & tasks/)

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /switch to claude code/i })).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: /switch to claude code/i }))
    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith('test-project-id', 'ai_provider', 'claude-code')
  })

  it('saves project settings after debounce when a field changes', async () => {
    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(setConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'New Name' } })

    expect(vi.mocked(setProjectConfig)).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(updateProject)).toHaveBeenCalled()
    expect(vi.mocked(setProjectConfig)).toHaveBeenCalled()
    expect(vi.mocked(setConfig)).not.toHaveBeenCalled()
  })

  it('does not clear global settings when project autosave runs before global settings hydrate', async () => {
    vi.mocked(getConfig).mockImplementation(() => new Promise<string | null>(() => {}))

    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(setProjectConfig).mockClear()
    vi.mocked(setConfig).mockClear()
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'New Name' } })

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(updateProject)).toHaveBeenCalled()
    expect(vi.mocked(setConfig)).not.toHaveBeenCalledWith('task_id_prefix', '')
    expect(vi.mocked(setConfig)).not.toHaveBeenCalledWith('github_token', '')
    expect(vi.mocked(setConfig)).not.toHaveBeenCalled()
  })

  it('updates projects store with new name and path after save', async () => {
    render(SettingsView, { props: defaultProps })

    await vi.advanceTimersByTimeAsync(50)
    vi.mocked(updateProject).mockClear()

    const nameInput = screen.getByPlaceholderText('My Project')
    await fireEvent.input(nameInput, { target: { value: 'Updated Name' } })

    await vi.advanceTimersByTimeAsync(600)

    const updatedProject = get(projects).find(p => p.id === 'test-project-id')
    expect(updatedProject?.name).toBe('Updated Name')
    expect(updatedProject?.path).toBe('/tmp/test')
    expect(get(projects).length).toBe(1)
  })
})
