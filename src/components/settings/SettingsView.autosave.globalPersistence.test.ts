import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { defaultProps, openSettingsCategory } from './SettingsView.testUtils'
import { setupSettingsViewAutosaveSuite } from './SettingsView.autosave.testFixture'
import {
  getAllWhisperModelStatuses,
  getConfig,
  setConfig,
  setProjectConfig,
  updateProject,
} from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

setupSettingsViewAutosaveSuite()


describe('SettingsView autosave global persistence', () => {
  it('keeps global settings controls disabled until global settings hydrate', async () => {
    activeProjectId.set(null)
    projects.set([])
    const resolvers = new Map<string, (value: string | null) => void>()
    vi.mocked(getConfig).mockImplementation((key: string) => new Promise<string | null>((resolve) => {
      resolvers.set(key, resolve)
    }))

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    expect(requireElement(screen.getByTestId('task_id_prefix'), HTMLInputElement).disabled).toBe(true)
    expect(requireElement(screen.getByTestId('task_display_title_metadata_updates_enabled'), HTMLInputElement).disabled).toBe(true)

    await openSettingsCategory(/GitHub & Credentials/)
    expect(requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement).disabled).toBe(true)
    expect(requireElement(screen.getByTestId('github_poll_interval'), HTMLInputElement).disabled).toBe(true)

    await vi.waitFor(() => {
      expect(resolvers.size).toBeGreaterThanOrEqual(7)
    })
    resolvers.get('task_id_prefix')?.('OF')
    resolvers.get('github_token')?.('ghp_old')
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
    expect(requireElement(screen.getByTestId('task_display_title_metadata_updates_enabled'), HTMLInputElement).disabled).toBe(false)
  })

  it('saves global settings after debounce when a field changes', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openSettingsCategory(/GitHub & Credentials/)

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
    await openSettingsCategory(/GitHub & Credentials/)

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
    await openSettingsCategory(/GitHub & Credentials/)

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

    await openSettingsCategory(/GitHub & Credentials/)
    const tokenInput = screen.getByPlaceholderText('ghp_...')
    await fireEvent.input(tokenInput, { target: { value: 'ghp_new' } })

    await vi.advanceTimersByTimeAsync(600)

    expect(vi.mocked(setConfig)).toHaveBeenCalledWith('github_token', 'ghp_new')
  })
})
