import { render, screen, fireEvent } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsGeneralCard from './SettingsGeneralCard.svelte'
import { openUrl } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({ openUrl: vi.fn() }))

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'Test Project',
    projectPath: '/tmp/test',
    aiProvider: 'claude-code',
    projectColor: '',
    disabled: false,
    opencodeInstalled: false,
    opencodeVersion: null,
    claudeInstalled: true,
    claudeVersion: '1.0.0',
    claudeAuthenticated: true,
    piInstalled: false,
    piVersion: null,
    codexInstalled: false,
    codexVersion: null,
    onProjectNameChange: vi.fn(),
    onProjectPathChange: vi.fn(),
    onAiProviderChange: vi.fn(),
    useWorktrees: true,
    onProjectColorChange: vi.fn(),
    onUseWorktreesChange: vi.fn(),
    onRefreshInstallationStatus: vi.fn(),
    ...overrides,
  }
}

describe('SettingsGeneralCard', () => {
  it('renders General heading', () => {
    render(SettingsGeneralCard, { props: defaultProps() })

    expect(screen.getByText('General')).toBeTruthy()
  })

  it('uses the shared default project color token for the default swatch', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsGeneralCard.svelte'), 'utf8')

    expect(source).toContain('DEFAULT_PROJECT_COLOR')
    expect(source).not.toContain('background-color: #9ca3af')
  })

  it('exposes project color swatches as a named single-select group', () => {
    render(SettingsGeneralCard, { props: defaultProps({ projectColor: 'rose' }) })

    expect(screen.getByRole('radiogroup', { name: 'Project Color' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Default Gray (no accent color)' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'Rose project color' }).getAttribute('aria-checked')).toBe('true')
  })

  it('uses roving tabindex for project color radio swatches', () => {
    render(SettingsGeneralCard, { props: defaultProps({ projectColor: 'rose' }) })

    expect(screen.getByRole('radio', { name: 'Default Gray (no accent color)' }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('radio', { name: 'Rose project color' }).getAttribute('tabindex')).toBe('0')
  })

  it('moves project color selection with radio-group arrow keys', async () => {
    const onProjectColorChange = vi.fn()
    render(SettingsGeneralCard, { props: defaultProps({ projectColor: 'rose', onProjectColorChange }) })

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Rose project color' }), { key: 'ArrowRight' })
    expect(onProjectColorChange).toHaveBeenLastCalledWith('amber')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Rose project color' }), { key: 'ArrowLeft' })
    expect(onProjectColorChange).toHaveBeenLastCalledWith('slate')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Rose project color' }), { key: 'Home' })
    expect(onProjectColorChange).toHaveBeenLastCalledWith('')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Rose project color' }), { key: 'End' })
    expect(onProjectColorChange).toHaveBeenLastCalledWith('indigo')
  })

  it('uses native disabled semantics for form controls when disabled', () => {
    render(SettingsGeneralCard, { props: defaultProps({ disabled: true }) })

    expect(requireElement(screen.getByLabelText('Project Name'), HTMLInputElement).disabled).toBe(true)
    expect(requireElement(screen.getByLabelText('Project Path'), HTMLInputElement).disabled).toBe(true)
    expect(requireElement(screen.getByRole('combobox'), HTMLSelectElement).disabled).toBe(true)
  })

  it('removes project color radios from tab order and suppresses activation when disabled', async () => {
    const onProjectColorChange = vi.fn()
    render(SettingsGeneralCard, {
      props: defaultProps({ disabled: true, projectColor: 'rose', onProjectColorChange }),
    })

    const selectedRadio = screen.getByRole('radio', { name: 'Rose project color' })
    const defaultRadio = screen.getByRole('radio', { name: 'Default Gray (no accent color)' })

    expect(selectedRadio.getAttribute('aria-disabled')).toBe('true')
    expect(selectedRadio.getAttribute('tabindex')).toBe('-1')
    expect(defaultRadio.getAttribute('aria-disabled')).toBe('true')
    expect(defaultRadio.getAttribute('tabindex')).toBe('-1')

    await fireEvent.click(defaultRadio)
    await fireEvent.keyDown(selectedRadio, { key: 'ArrowRight' })

    expect(onProjectColorChange).not.toHaveBeenCalled()
  })

  describe('default workspace setting', () => {
    it('renders a per-project default worktree toggle', () => {
      render(SettingsGeneralCard, { props: defaultProps({ useWorktrees: false }) })

      const toggle = requireElement(screen.getByLabelText('Default new tasks to worktrees'), HTMLInputElement)
      expect(toggle.checked).toBe(false)
      expect(screen.getByText('New tasks default to the project directory')).toBeTruthy()
    })

    it('notifies when the default worktree toggle changes', async () => {
      const onUseWorktreesChange = vi.fn()
      render(SettingsGeneralCard, { props: defaultProps({ useWorktrees: true, onUseWorktreesChange }) })

      await fireEvent.click(screen.getByLabelText('Default new tasks to worktrees'))

      expect(onUseWorktreesChange).toHaveBeenCalledWith(false)
    })
  })

  describe('AI Provider', () => {
    it('renders provider options', () => {
      render(SettingsGeneralCard, { props: defaultProps() })

      const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
      const options = Array.from(select.options).map((o) => o.value)
      expect(options).toContain('claude-code')
      expect(options).toContain('opencode')
      expect(options).toContain('pi')
      expect(options).toContain('codex')
    })

    it('renders Pi installed status', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ piInstalled: true, piVersion: '1.2.3' }),
      })

      expect(screen.getByText('Pi 1.2.3')).toBeTruthy()
    })

    it('renders Pi not installed status', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ piInstalled: false, piVersion: null }),
      })

      expect(screen.getByText('Pi not installed')).toBeTruthy()
    })

    it('renders provider-specific recovery actions when selected provider is Pi and not installed', async () => {
      const onRefreshInstallationStatus = vi.fn()
      const onAiProviderChange = vi.fn()
      render(SettingsGeneralCard, {
        props: defaultProps({
          aiProvider: 'pi',
          piInstalled: false,
          claudeInstalled: true,
          claudeAuthenticated: true,
          onRefreshInstallationStatus,
          onAiProviderChange,
        }),
      })

      expect(screen.getByText('Pi Coding Agent is not installed')).toBeTruthy()
      expect(screen.getByText(/Install the Pi Coding Agent CLI/i)).toBeTruthy()

      await fireEvent.click(screen.getByRole('button', { name: /refresh install status/i }))
      expect(onRefreshInstallationStatus).toHaveBeenCalledOnce()

      await fireEvent.click(screen.getByRole('button', { name: /switch to claude code/i }))
      expect(onAiProviderChange).toHaveBeenCalledWith('claude-code')
    })

    it('renders Codex installed status', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ codexInstalled: true, codexVersion: 'codex-cli 0.137.0' }),
      })

      expect(screen.getByText('Codex codex-cli 0.137.0')).toBeTruthy()
    })

    it('renders Codex not installed status', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ codexInstalled: false, codexVersion: null }),
      })

      expect(screen.getByText('Codex not installed')).toBeTruthy()
    })

    it('renders warning when selected provider is Codex and not installed', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ aiProvider: 'codex', codexInstalled: false }),
      })

      expect(screen.getByText('Codex is not installed')).toBeTruthy()
    })

    it('renders authentication recovery when Claude Code is installed but not authenticated', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ aiProvider: 'claude-code', claudeInstalled: true, claudeAuthenticated: false }),
      })

      expect(screen.getByText('Claude Code needs authentication')).toBeTruthy()
      expect(screen.getByText(/run claude login/i)).toBeTruthy()
    })

    it('does not offer unauthenticated Claude Code as a recovery switch target', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({
          aiProvider: 'pi',
          piInstalled: false,
          claudeInstalled: true,
          claudeAuthenticated: false,
        }),
      })

      expect(screen.queryByRole('button', { name: /switch to claude code/i })).toBeNull()
    })

    describe('provider availability gating', () => {
      function optionByValue(value: string) {
        const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
        const option = Array.from(select.options).find((o) => o.value === value)
        if (!option) throw new Error(`Option for provider "${value}" not found`)
        return option
      }

      it('disables not-installed providers and keeps installed ones selectable', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({
            claudeInstalled: true,
            claudeAuthenticated: true,
            opencodeInstalled: false,
            piInstalled: false,
            codexInstalled: false,
          }),
        })

        expect(optionByValue('claude-code').disabled).toBe(false)
        expect(optionByValue('opencode').disabled).toBe(true)
        expect(optionByValue('pi').disabled).toBe(true)
        expect(optionByValue('codex').disabled).toBe(true)
      })

      it('keeps installed-but-unauthenticated Claude Code selectable', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({ claudeInstalled: true, claudeAuthenticated: false }),
        })

        expect(optionByValue('claude-code').disabled).toBe(false)
      })

      it('labels a not-installed provider option to explain why it is unavailable', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({ opencodeInstalled: false, claudeInstalled: true }),
        })

        expect(optionByValue('opencode').textContent).toMatch(/not installed/i)
        expect(optionByValue('claude-code').textContent).not.toMatch(/not installed/i)
      })

      it('does not disable any option while install status is still loading', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({
            installationStatusLoading: true,
            opencodeInstalled: false,
            piInstalled: false,
            codexInstalled: false,
          }),
        })

        expect(optionByValue('opencode').disabled).toBe(false)
        expect(optionByValue('pi').disabled).toBe(false)
        expect(optionByValue('codex').disabled).toBe(false)
      })

      it('does not disable any option when the install status check errored', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({
            installationStatusError: 'spawn check failed',
            opencodeInstalled: false,
            piInstalled: false,
            codexInstalled: false,
          }),
        })

        expect(optionByValue('opencode').disabled).toBe(false)
        expect(optionByValue('pi').disabled).toBe(false)
        expect(optionByValue('codex').disabled).toBe(false)
      })

      it('ignores selection of a not-installed provider', async () => {
        const onAiProviderChange = vi.fn()
        render(SettingsGeneralCard, {
          props: defaultProps({
            aiProvider: 'claude-code',
            claudeInstalled: true,
            opencodeInstalled: false,
            onAiProviderChange,
          }),
        })

        const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
        await fireEvent.change(select, { target: { value: 'opencode' } })

        expect(onAiProviderChange).not.toHaveBeenCalled()
      })

      it('still applies selection of an installed provider', async () => {
        const onAiProviderChange = vi.fn()
        render(SettingsGeneralCard, {
          props: defaultProps({
            aiProvider: 'claude-code',
            claudeInstalled: true,
            piInstalled: true,
            piVersion: '1.2.3',
            onAiProviderChange,
          }),
        })

        const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
        await fireEvent.change(select, { target: { value: 'pi' } })

        expect(onAiProviderChange).toHaveBeenCalledWith('pi')
      })
    })

    describe('install links for not-installed providers', () => {
      beforeEach(() => {
        vi.mocked(openUrl).mockClear()
      })

      it('opens the install site for a not-installed provider', async () => {
        render(SettingsGeneralCard, { props: defaultProps({ opencodeInstalled: false }) })

        await fireEvent.click(screen.getByRole('button', { name: /install opencode/i }))

        expect(openUrl).toHaveBeenCalledWith('https://opencode.ai')
      })

      it('opens the Pi quickstart for a not-installed Pi', async () => {
        render(SettingsGeneralCard, { props: defaultProps({ piInstalled: false }) })

        await fireEvent.click(screen.getByRole('button', { name: /install pi/i }))

        expect(openUrl).toHaveBeenCalledWith('https://pi.dev/docs/latest/quickstart')
      })

      it('does not show an install link for an installed provider', () => {
        render(SettingsGeneralCard, {
          props: defaultProps({ claudeInstalled: true, claudeVersion: '1.0.0' }),
        })

        expect(screen.queryByRole('button', { name: /install claude code/i })).toBeNull()
      })
    })
  })
})
