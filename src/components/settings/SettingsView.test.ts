import fs from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { defaultProps, resetSettingsViewTest } from './SettingsView.testUtils'
import { getAllWhisperModelStatuses, getDeveloperLogSnapshot, getProjectConfig, getProjectTaskLabels } from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

describe('SettingsView rendering and navigation', () => {
  beforeEach(resetSettingsViewTest)

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

  it('renders the opt-in Companion section on the global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    expect(await screen.findByText('Companion')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enable Companion Gateway' })).toBeTruthy()
  })

  it('live-refreshes the full OpenForge log trace in the global Developer section', async () => {
    vi.useFakeTimers()
    activeProjectId.set(null)
    projects.set([])
    vi.mocked(getDeveloperLogSnapshot)
      .mockResolvedValueOnce({
        entries: [
          {
            id: 1,
            timestamp: '2026-07-03T12:00:00.000Z',
            level: 'info',
            message: '[electron] app ready',
          },
        ],
        logFilePath: '/tmp/openforge.log',
        totalEntries: 1,
      })
      .mockResolvedValueOnce({
        entries: [
          {
            id: 1,
            timestamp: '2026-07-03T12:00:00.000Z',
            level: 'info',
            message: '[electron] app ready',
          },
          {
            id: 2,
            timestamp: '2026-07-03T12:00:01.000Z',
            level: 'info',
            message: '[sidecar] booted',
          },
        ],
        logFilePath: '/tmp/openforge.log',
        totalEntries: 2,
      })

    const { unmount } = render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    try {
      await vi.waitFor(() => {
        expect(screen.getByText('Developer')).toBeTruthy()
        expect(screen.getByText(/\[electron\] app ready/)).toBeTruthy()
      })
      expect(getDeveloperLogSnapshot).toHaveBeenCalledWith(1000)

      await vi.advanceTimersByTimeAsync(1000)

      await vi.waitFor(() => {
        expect(screen.getByText(/\[sidecar\] booted/)).toBeTruthy()
      })
      expect(getDeveloperLogSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      unmount()
      vi.useRealTimers()
    }
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

  it('renders Task Labels management on the project settings page', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([{ id: 1, project_id: 'test-project-id', name: 'bug' }])
    render(SettingsView, { props: defaultProps })

    expect(await screen.findByText('Task Labels')).toBeTruthy()
    expect(screen.getByText('bug')).toBeTruthy()
    expect(getProjectTaskLabels).toHaveBeenCalledWith('test-project-id')
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
    expect(screen.getByPlaceholderText(/## Summary/i)).toBeTruthy()
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
