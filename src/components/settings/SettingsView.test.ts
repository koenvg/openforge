import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { defaultProps, openSettingsCategory } from './SettingsView.testUtils'
import { resetSettingsViewNavigationTest } from './SettingsView.navigation.testFixture'
import { getAllWhisperModelStatuses, getProjectConfig } from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

describe('SettingsView rendering and navigation', () => {
  beforeEach(resetSettingsViewNavigationTest)


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

  it('gives each PR guidance setting a single home on the global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    for (const key of ['pr_review_guidance', 'pr_walkthrough_guidance']) {
      expect(screen.queryAllByTestId(key).length).toBe(0)
    }

    await openSettingsCategory(/^Agents/)
    for (const key of ['pr_review_guidance', 'pr_walkthrough_guidance']) {
      expect(screen.queryAllByTestId(key).length).toBe(1)
    }

    await openSettingsCategory(/GitHub & Credentials/)
    for (const key of ['pr_review_guidance', 'pr_walkthrough_guidance']) {
      expect(screen.queryAllByTestId(key).length).toBe(0)
    }
  })

  it('separates the PR guidance fields from the provider card', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openSettingsCategory(/^Agents/)

    // Its own card, so the provider selector no longer sits directly above the
    // two long prompt fields.
    const section = document.querySelector('#section-pr-review-prompt')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain('PR review prompt')
    expect(section?.querySelector('[data-testid="pr_review_guidance"]')).not.toBeNull()
    expect(section?.querySelector('[data-testid="pr_walkthrough_guidance"]')).not.toBeNull()
    expect(section?.querySelector('[data-testid="ai_provider"]')).toBeNull()

    const providerCard = document.querySelector('#section-configuration')
    expect(providerCard?.querySelector('[data-testid="pr_review_guidance"]')).toBeNull()
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

  it('keeps project configuration in Agents & tasks instead of duplicating it in General', async () => {
    render(SettingsView, { props: defaultProps })

    expect(screen.queryByText('Project configuration')).toBeNull()
    expect(screen.queryByTestId('task_id_prefix')).toBeNull()

    await openSettingsCategory(/Agents & tasks/)

    expect(screen.getByText('Project configuration')).toBeTruthy()
    expect(screen.getByTestId('task_id_prefix')).toBeTruthy()
  })

  it('navigates project settings categories without search controls or a long page', async () => {
    render(SettingsView, { props: defaultProps })

    const navigation = screen.getByRole('navigation', { name: 'Settings categories' })
    expect(navigation).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('button', { name: /^General/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /AI instructions/i })).toBeTruthy()
    expect(screen.getByPlaceholderText('My Project')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Optional instructions prepended/)).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /AI instructions/i }))
    expect(screen.getByPlaceholderText(/Optional instructions prepended/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
  })

  it('moves category focus with arrow keys', async () => {
    render(SettingsView, { props: defaultProps })
    const general = screen.getByRole('button', { name: /^General/ })
    const agents = screen.getByRole('button', { name: /Agents & tasks/ })

    general.focus()
    await fireEvent.keyDown(general, { key: 'ArrowDown' })

    expect(document.activeElement).toBe(agents)
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

  it('renders AI instructions textarea', async () => {
    render(SettingsView, { props: defaultProps })
    await openSettingsCategory(/AI instructions/)
    expect(
      screen.getByPlaceholderText(
        'Optional instructions prepended to the first prompt when starting a new task...'
      )
    ).toBeTruthy()
  })
  it('renders GitHub PAT field on global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openSettingsCategory(/GitHub & Credentials/)
    expect(screen.getByPlaceholderText('ghp_...')).toBeTruthy()
  })

  it('shows Project Settings header when project is active', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByText('Test Project / Project Settings')).toBeTruthy()
    expect(screen.getByText(/Configure settings for this project only/)).toBeTruthy()
  })

  it('shows Global Settings header when no project is active', () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    expect(screen.queryAllByText(/global settings/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Configure app-wide defaults, integrations, and credentials.')).toBeTruthy()
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
  it('GitHub PAT field has type=password on global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    await openSettingsCategory(/GitHub & Credentials/)
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

    await openSettingsCategory(/Voice & Whisper/)
    await vi.waitFor(() => {
      expect(screen.queryAllByText(/tiny/i).length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/keeps the model in memory for five minutes/i)).toBeTruthy()
    expect(screen.getByText(/next dictation reloads the model and may start more slowly/i)).toBeTruthy()
  })

  it('renders a Delete Project button in the danger zone', async () => {
    render(SettingsView, { props: defaultProps })
    await openSettingsCategory(/Danger Zone/)
    expect(screen.getByRole('button', { name: /delete project/i })).toBeTruthy()
  })

  it('defaults to global page when activeProjectId is null', () => {
    activeProjectId.set(null)
    projects.set([])

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    expect(screen.queryByPlaceholderText('My Project')).toBeNull()
    expect(screen.getByRole('main', { name: 'Global settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /GitHub & Credentials/ })).toBeTruthy()
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
