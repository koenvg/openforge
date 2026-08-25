import { fireEvent, render, screen } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { defaultProps } from './SettingsView.testUtils'
import { resetSettingsViewAutosaveTest } from './SettingsView.autosave.testFixture'
import {
  checkClaudeInstalled,
  checkPiInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
  setConfig,
  setProjectConfig,
  updateProject,
} from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

describe('SettingsView auto-save', () => {
  beforeEach(resetSettingsViewAutosaveTest)

  async function openGithubCategory() {
    await fireEvent.click(screen.getByRole('button', { name: /GitHub & Credentials/ }))
  }

  async function openAgentsCategory() {
    await fireEvent.click(screen.getByRole('button', { name: /Agents & tasks/ }))
  }

  describe('auto-save', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

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

    it('refreshes provider installation status from the recovery warning', async () => {
      vi.mocked(getProjectConfig).mockImplementation(async (_projectId: string, key: string) => {
        if (key === 'ai_provider') return 'pi'
        return null
      })
      vi.mocked(checkPiInstalled)
        .mockResolvedValueOnce({ installed: false, path: null, version: null })
        .mockResolvedValueOnce({ installed: true, path: '/usr/local/bin/pi', version: '2.0.0' })

      render(SettingsView, { props: defaultProps })
      await openAgentsCategory()

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
      await openAgentsCategory()

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

    it('keeps global settings controls disabled until global settings hydrate', async () => {
      activeProjectId.set(null)
      projects.set([])
      const resolvers = new Map<string, (value: string | null) => void>()
      vi.mocked(getConfig).mockImplementation((key: string) => new Promise<string | null>((resolve) => {
        resolvers.set(key, resolve)
      }))

      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

      expect(requireElement(screen.getByTestId('task_id_prefix'), HTMLInputElement).disabled).toBe(true)
      expect(requireElement(screen.getByTestId('code_cleanup_tasks_enabled'), HTMLInputElement).disabled).toBe(true)
      expect(requireElement(screen.getByTestId('task_display_title_metadata_updates_enabled'), HTMLInputElement).disabled).toBe(true)

      await openGithubCategory()
      expect(requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement).disabled).toBe(true)
      expect(requireElement(screen.getByTestId('github_poll_interval'), HTMLInputElement).disabled).toBe(true)

      await vi.waitFor(() => {
        expect(resolvers.size).toBeGreaterThanOrEqual(7)
      })
      resolvers.get('task_id_prefix')?.('OF')
      resolvers.get('github_token')?.('ghp_old')
      resolvers.get('code_cleanup_tasks_enabled')?.('false')
      resolvers.get('task_display_title_metadata_updates_enabled')?.('false')
      resolvers.get('github_poll_interval')?.('60')
      resolvers.get('use_worktrees')?.('true')
      resolvers.get('ai_provider')?.('claude-code')
      resolvers.get('pr_walkthrough_prompt')?.('Prompt')
      resolvers.get('ghostty_terminal_state_enabled')?.('false')

      await vi.waitFor(() => {
        expect(requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement).disabled).toBe(false)
        expect(requireElement(screen.getByTestId('github_poll_interval'), HTMLInputElement).disabled).toBe(false)
      })
      await fireEvent.click(screen.getByRole('button', { name: /^General/ }))
      expect(requireElement(screen.getByTestId('task_id_prefix'), HTMLInputElement).disabled).toBe(false)
      expect(requireElement(screen.getByTestId('code_cleanup_tasks_enabled'), HTMLInputElement).disabled).toBe(false)
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

    it('saves global settings after debounce when a field changes', async () => {
      activeProjectId.set(null)
      projects.set([])
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
      await openGithubCategory()

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setConfig).mockClear()

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setConfig)).toHaveBeenCalledOnce()
      expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_new')
    })

    it('retries only the failed global setting after an autosave error', async () => {
      activeProjectId.set(null)
      projects.set([])
      vi.mocked(setConfig)
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValue(undefined)
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
      await openGithubCategory()

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setConfig).mockClear()

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })
      await vi.advanceTimersByTimeAsync(600)

      await vi.waitFor(() => {
        expect(screen.getByText('Autosave failed: disk full')).toBeTruthy()
      })
      await fireEvent.click(screen.getByRole('button', { name: /retry autosave/i }))

      await vi.waitFor(() => {
        expect(screen.getByText('All changes saved')).toBeTruthy()
      })
      expect(vi.mocked(setConfig)).toHaveBeenCalledTimes(2)
      expect(vi.mocked(setConfig)).toHaveBeenNthCalledWith(1, 'github_token', 'ghp_new')
      expect(vi.mocked(setConfig)).toHaveBeenNthCalledWith(2, 'github_token', 'ghp_new')
    })

    it('hydrates and saves the Task Display Title metadata updates experiment toggle', async () => {
      activeProjectId.set(null)
      projects.set([])
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'task_display_title_metadata_updates_enabled') return 'true'
        if (key === 'github_poll_interval') return '60'
        return null
      })

      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

      const toggle = requireElement(
        await screen.findByTestId('task_display_title_metadata_updates_enabled'),
        HTMLInputElement,
      )

      await vi.waitFor(() => {
        expect(toggle.checked).toBe(true)
      })
      vi.mocked(setConfig).mockClear()

      await fireEvent.click(toggle)
      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setConfig)).toHaveBeenCalledWith('task_display_title_metadata_updates_enabled', 'false')
    })
    it('does not save active project settings from the global settings page', async () => {
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
      await openGithubCategory()

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setConfig).mockClear()
      vi.mocked(setProjectConfig).mockClear()
      vi.mocked(updateProject).mockClear()

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setConfig)).toHaveBeenCalled()
      expect(vi.mocked(setProjectConfig)).not.toHaveBeenCalled()
      expect(vi.mocked(updateProject)).not.toHaveBeenCalled()
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
      await openGithubCategory()

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
      await openGithubCategory()

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(updateProject)).toHaveBeenCalled()
      expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_new')
    })

    it('hydrates and saves global settings without waiting for Whisper status loading', async () => {
      activeProjectId.set(null)
      projects.set([])
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        if (key === 'task_id_prefix') return 'OF'
        if (key === 'github_token') return 'ghp_old'
        if (key === 'github_poll_interval') return '60'
        return null
      })
      vi.mocked(getAllWhisperModelStatuses).mockImplementation(() => new Promise(() => {}))

      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('OF')).toBeTruthy()
      })
      vi.mocked(setConfig).mockClear()

      await openGithubCategory()
      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

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

})
