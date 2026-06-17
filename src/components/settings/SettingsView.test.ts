import fs from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'

vi.mock('../../lib/ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getConfig: vi.fn(() => Promise.resolve(null)),
  setConfig: vi.fn(() => Promise.resolve(undefined)),
  checkOpenCodeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkClaudeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null, authenticated: false })),
  checkPiInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkCodexInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  getAllWhisperModelStatuses: vi.fn(() => Promise.resolve([])),
  setWhisperModel: vi.fn(),
}))

vi.mock('../../lib/actions', () => ({
  loadActions: vi.fn(),
  saveActions: vi.fn(),
  createAction: vi.fn(),
  DEFAULT_ACTIONS: [
    { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
  ],
}))

vi.mock('../../lib/boardFilters', () => ({
  loadFocusFilterStates: vi.fn(() => Promise.resolve(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'])),
  saveFocusFilterStates: vi.fn(() => Promise.resolve(undefined)),
  DEFAULT_FOCUS_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
  FOCUS_FILTER_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
}))

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable('test-project-id'),
  activeProjectColorId: writable<string | null>(null),
  projects: writable([
    {
      id: 'test-project-id',
      name: 'Test Project',
      path: '/tmp/test',
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ]),
  codeCleanupTasksEnabled: writable(false),
  error: writable<string | null>(null),
}))

import { createAction, loadActions, saveActions } from '../../lib/actions'
import {
  deleteProject,
  getAllWhisperModelStatuses,
  checkClaudeInstalled,
  checkPiInstalled,
  getConfig,
  getProjectConfig,
  setConfig,
  setProjectConfig,
  updateProject,
} from '../../lib/ipc'
import { activeProjectColorId, activeProjectId, projects } from '../../lib/stores'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import SettingsView from './SettingsView.svelte'

const defaultProps = {
  onClose: vi.fn(),
  onProjectDeleted: vi.fn(),
  mode: 'project' as const,
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    vi.mocked(setConfig).mockResolvedValue(undefined)
    vi.mocked(updateProject).mockResolvedValue(undefined)
    vi.mocked(deleteProject).mockResolvedValue(undefined)
    vi.mocked(checkClaudeInstalled).mockResolvedValue({ installed: false, path: null, version: null, authenticated: false })
    vi.mocked(checkPiInstalled).mockResolvedValue({ installed: false, path: null, version: null })
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([])
    vi.mocked(loadActions).mockResolvedValue([])

    activeProjectId.set('test-project-id')
    activeProjectColorId.set(null)
    projects.set([
      {
        id: 'test-project-id',
        name: 'Test Project',
        path: '/tmp/test',
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ])
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    clearComponentRegistry()
  })

  it('renders General section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/general/i).length).toBeGreaterThan(0)
  })

  it('does not render removed Integrations section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/integrations/i).length).toBe(0)
  })

  it('renders Instructions section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/instructions/i).length).toBeGreaterThan(0)
  })

  it('renders AI section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/ai/i).length).toBeGreaterThan(0)
  })

  it('renders Credentials section on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryAllByText(/credentials/i).length).toBeGreaterThan(0)
  })

  it('renders Actions section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/actions/i).length).toBeGreaterThan(0)
  })

  it('renders General section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/general/i).length).toBeGreaterThan(0)
  })

  it('does not render Board Columns section', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByText(/Board Columns/i)).toBeNull()
  })

  it('does not render removed Integrations section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/integrations/i).length).toBe(0)
  })

  it('renders Instructions section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/instructions/i).length).toBeGreaterThan(0)
  })

  it('implements single-column architecture: does not render in-page sidebar navigation in any mode', () => {
    const { unmount } = render(SettingsView, { props: defaultProps })
    let links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
    unmount()

    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    links = screen.queryAllByRole('link')
    expect(links.length).toBe(0)
  })

  it('ensures SettingsSidebar component has been removed as part of the single-column architecture', () => {
    const sidebarPath = path.join(process.cwd(), 'src/components/settings/SettingsSidebar.svelte')
    expect(fs.existsSync(sidebarPath)).toBe(false)
  })

  it('renders Actions section card', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryAllByText(/actions/i).length).toBeGreaterThan(0)
  })

  it('renders plugin settings sections on the project settings page', async () => {
    installedPlugins.set(new Map([[
      'plugin.settings',
      {
        manifest: {
          id: 'plugin.settings',
          name: 'Settings Plugin',
          version: '1.0.0',
          apiVersion: 1,
          description: 'Adds a settings section',
          permissions: [],
          frontend: 'index.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      },
    ]]))
    enabledPluginIds.set(new Set(['plugin.settings']))
    runtimeContributionSources.set(new Map([[
      'plugin.settings',
      { pluginId: 'plugin.settings', settingsSections: [{ id: 'advanced', title: 'Advanced Plugin Settings' }] },
    ]]))
    registerRenderableContributionComponent('settingsSections', 'plugin.settings:advanced', PluginSlotTestView)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Advanced Plugin Settings')).toBeTruthy()
      expect(document.querySelector('[data-slot-type="settingsSections"][data-slot-id="plugin.settings:advanced"]')).toBeTruthy()
    })
  })

  it('renders project name field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('My Project')).toBeTruthy()
  })

  it('renders project path field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByPlaceholderText('/path/to/project')).toBeTruthy()
  })

  it('does not render removed GitHub repository field', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByPlaceholderText('owner/repo')).toBeNull()
  })

  it('renders AI instructions textarea', () => {
    render(SettingsView, { props: defaultProps })
    expect(
      screen.getByPlaceholderText(
        'Optional instructions prepended to the first prompt when starting a new task...'
      )
    ).toBeTruthy()
  })

  it('renders the project handoff notes template textarea', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText('Handoff Notes Template')).toBeTruthy()
    expect(screen.getByPlaceholderText(/## Current summary/i)).toBeTruthy()
  })

  it('renders GitHub PAT field on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('shows Project Settings header when project is active', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText('Test Project — Project Settings')).toBeTruthy()
    expect(screen.getByText('Configure settings for this project only')).toBeTruthy()
  })

  it('shows Global Settings header when no project is active', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryAllByText(/global settings/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Configure app-wide preferences and credentials')).toBeTruthy()
  })

  it('renders a visible Board return control on project settings', async () => {
    const onClose = vi.fn()
    render(SettingsView, { props: { ...defaultProps, onClose } })

    await fireEvent.click(screen.getByRole('button', { name: /back to board/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a visible Board return control on global settings', async () => {
    const onClose = vi.fn()
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const, onClose } })

    await fireEvent.click(screen.getByRole('button', { name: /back to board/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders project name in header in project mode', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText(/Test Project/)).toBeTruthy()
  })

  it('does not show global cards on project page', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByPlaceholderText('ghp_...')).toBeNull()
  })

  it('does not show project cards on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryByPlaceholderText('owner/repo')).toBeNull()
  })

  it('does not render a Save Settings button (auto-save replaces it)', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.queryByRole('button', { name: /save settings/i })).toBeNull()
  })

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

    it('updates the shared active project color before debounced persistence', async () => {
      render(SettingsView, { props: defaultProps })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setProjectConfig).mockClear()

      await fireEvent.click(screen.getByTitle('Violet'))

      expect(get(activeProjectColorId)).toBe('violet')
      expect(vi.mocked(setProjectConfig)).not.toHaveBeenCalled()
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
      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith('test-project-id', 'handoff_notes_template', '')
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
      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith('test-project-id', 'handoff_notes_template', '')
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

      const prefixInput = requireElement(screen.getByPlaceholderText('e.g. ABC'), HTMLInputElement)
      const pollIntervalInput = requireElement(screen.getByTestId('poll-interval-input'), HTMLInputElement)
      const tokenInput = requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement)
      const cleanupToggle = requireElement(screen.getByTestId('code-cleanup-tasks-toggle'), HTMLInputElement)

      expect(prefixInput.disabled).toBe(true)
      expect(pollIntervalInput.disabled).toBe(true)
      expect(tokenInput.disabled).toBe(true)
      expect(cleanupToggle.disabled).toBe(true)

      await vi.waitFor(() => {
        expect(resolvers.size).toBeGreaterThanOrEqual(4)
      })

      resolvers.get('task_id_prefix')?.('OF')
      resolvers.get('github_token')?.('ghp_old')
      resolvers.get('code_cleanup_tasks_enabled')?.('false')
      resolvers.get('github_poll_interval')?.('60')

      await vi.waitFor(() => {
        expect(prefixInput.disabled).toBe(false)
        expect(pollIntervalInput.disabled).toBe(false)
        expect(tokenInput.disabled).toBe(false)
        expect(cleanupToggle.disabled).toBe(false)
      })
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

    it('saves global settings after debounce when a field changes', async () => {
      activeProjectId.set(null)
      projects.set([])
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

      await vi.advanceTimersByTimeAsync(50)
      vi.mocked(setConfig).mockClear()

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(setConfig)).toHaveBeenCalled()
    })

    it('does not save active project settings from the global settings page', async () => {
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

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
      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith('test-project-id', 'handoff_notes_template', '')
      expect(vi.mocked(setConfig)).not.toHaveBeenCalled()
    })

    it('persists pending global settings when switching to project settings before debounce fires', async () => {
      const { rerender } = render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

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

      const tokenInput = screen.getByPlaceholderText('ghp_...')
      await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

      await vi.advanceTimersByTimeAsync(600)

      expect(vi.mocked(updateProject)).toHaveBeenCalled()
      expect(vi.mocked(setProjectConfig)).toHaveBeenCalledWith('test-project-id', 'handoff_notes_template', '')
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

    it('cancels a pending debounced save when resetting actions and persists once immediately', async () => {
      vi.mocked(loadActions).mockResolvedValue([
        { id: 'custom-1', name: 'Custom', prompt: 'test', builtin: false, enabled: true },
      ])

      let resolveSaveActions!: () => void
      vi.mocked(saveActions).mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSaveActions = resolve
        })
      )

      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('Custom')).toBeTruthy()
      })

      const nameInput = screen.getByPlaceholderText('My Project')
      await fireEvent.input(nameInput, { target: { value: 'Changed Name' } })

      const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
      await fireEvent.click(resetButton)

      await vi.waitFor(() => {
        expect(saveActions).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Saving changes…')).toBeTruthy()
      })

      await vi.advanceTimersByTimeAsync(600)

      expect(saveActions).toHaveBeenCalledTimes(1)

      resolveSaveActions()

      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() => {
        expect(screen.queryByText('Saving changes…')).toBeNull()
      })
    })

    it('cancels a pending debounced save when deleting an action and persists once immediately', async () => {
      vi.mocked(loadActions).mockResolvedValue([
        { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
      ])

      let resolveSaveActions!: () => void
      vi.mocked(saveActions).mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSaveActions = resolve
        })
      )

      vi.spyOn(window, 'confirm').mockReturnValue(true)

      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        expect(screen.getByText('Go')).toBeTruthy()
      })

      const nameInput = screen.getByPlaceholderText('My Project')
      await fireEvent.input(nameInput, { target: { value: 'Changed Name' } })

      const deleteButton = screen.getByTitle('Delete action')
      await fireEvent.click(deleteButton)

      await vi.waitFor(() => {
        expect(saveActions).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Saving changes…')).toBeTruthy()
      })

      await vi.advanceTimersByTimeAsync(600)

      expect(saveActions).toHaveBeenCalledTimes(1)

      resolveSaveActions()

      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() => {
        expect(screen.queryByText('Saving changes…')).toBeNull()
      })
    })
  })

  it('renders Add Action button', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /add action/i })).toBeTruthy()
  })

  it('clicking Add Action creates a new action entry', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(createAction).mockReturnValue({
      id: 'new-action-id',
      name: 'New Action',
      prompt: '',
      builtin: false,
      enabled: true,
    })

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const addButton = screen.getByRole('button', { name: /add action/i })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('New Action')).toBeTruthy()
    })
  })

  it('renders action toggle checkboxes', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })

  it('GitHub PAT field has type=password on global page', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const patInput = requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement)
    expect(patInput.type).toBe('password')
  })

  it('renders Whisper model selector on global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([
      {
        size: 'tiny',
        display_name: 'Tiny',
        disk_size_mb: 39,
        ram_usage_mb: 125,
        downloaded: true,
        model_path: '/tmp/tiny.bin',
        model_size_bytes: 40960000,
        model_name: 'ggml-tiny',
        is_active: true,
      },
    ])

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    await vi.waitFor(() => {
      expect(screen.queryAllByText(/tiny/i).length).toBeGreaterThan(0)
    })
  })

  it('renders a Delete Project button in the danger zone', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /delete project/i })).toBeTruthy()
  })

  it('defaults to global page when activeProjectId is null', () => {
    activeProjectId.set(null)
    projects.set([])

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('reset to defaults shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('deleting a builtin action shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('reset to defaults auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'custom-1', name: 'Custom', prompt: 'test', builtin: false, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('Custom')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', expect.any(Array))
    })

    window.confirm = globalThis.confirm
  })

  it('deleting a builtin action auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    vi.mocked(saveActions).mockClear()

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', [])
    })

    window.confirm = globalThis.confirm
  })

  describe('Board layout setting', () => {
    it('does not render a board layout select, as Flow Board is the only layout', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)
      render(SettingsView, { props: defaultProps })

      await vi.waitFor(() => {
        const select = screen.queryByTestId('board-layout-select')
        expect(select).toBeNull()
      })
    })
  })
})
