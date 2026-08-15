import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import ProviderSelectField from './ProviderSelectField.svelte'
import { openUrl } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({ openUrl: vi.fn() }))

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    aiProvider: 'claude-code',
    opencodeInstalled: false,
    opencodeVersion: null,
    claudeInstalled: true,
    claudeVersion: '1.0.0',
    claudeAuthenticated: true,
    piInstalled: false,
    piVersion: null,
    codexInstalled: false,
    codexVersion: null,
    grokInstalled: false,
    grokVersion: null,
    grokAuthenticated: false,
    onChange: vi.fn(),
    onRefreshInstallationStatus: vi.fn(),
    ...overrides,
  }
}

describe('ProviderSelectField', () => {
  it('renders provider options', () => {
    render(ProviderSelectField, { props: defaultProps() })

    const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toContain('claude-code')
    expect(options).toContain('opencode')
    expect(options).toContain('pi')
    expect(options).toContain('codex')
    expect(options).toContain('grok')
  })

  it('renders Pi installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ piInstalled: true, piVersion: '1.2.3' }),
    })

    expect(screen.getByText('Pi 1.2.3')).toBeTruthy()
  })

  it('renders Pi not installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ piInstalled: false, piVersion: null }),
    })

    expect(screen.getByText('Pi not installed')).toBeTruthy()
  })

  it('renders provider-specific recovery actions when selected provider is Pi and not installed', async () => {
    const onRefreshInstallationStatus = vi.fn()
    const onChange = vi.fn()
    render(ProviderSelectField, {
      props: defaultProps({
        aiProvider: 'pi',
        piInstalled: false,
        claudeInstalled: true,
        claudeAuthenticated: true,
        onRefreshInstallationStatus,
        onChange,
      }),
    })

    expect(screen.getByText('Pi Coding Agent is not installed')).toBeTruthy()
    expect(screen.getByText(/Install the Pi Coding Agent CLI/i)).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /refresh install status/i }))
    expect(onRefreshInstallationStatus).toHaveBeenCalledOnce()

    await fireEvent.click(screen.getByRole('button', { name: /switch to claude code/i }))
    expect(onChange).toHaveBeenCalledWith('claude-code')
  })

  it('renders Codex installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ codexInstalled: true, codexVersion: 'codex-cli 0.137.0' }),
    })

    expect(screen.getByText('Codex codex-cli 0.137.0')).toBeTruthy()
  })

  it('renders Codex not installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ codexInstalled: false, codexVersion: null }),
    })

    expect(screen.getByText('Codex not installed')).toBeTruthy()
  })

  it('renders warning when selected provider is Codex and not installed', () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'codex', codexInstalled: false }),
    })

    expect(screen.getByText('Codex is not installed')).toBeTruthy()
  })

  it('renders Grok installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ grokInstalled: true, grokVersion: 'grok-cli 0.1.0' }),
    })

    expect(screen.getByText('Grok grok-cli 0.1.0')).toBeTruthy()
  })

  it('renders Grok not installed status', () => {
    render(ProviderSelectField, {
      props: defaultProps({ grokInstalled: false, grokVersion: null }),
    })

    expect(screen.getByText('Grok not installed')).toBeTruthy()
  })

  it('renders warning when selected provider is Grok and not installed', () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'grok', grokInstalled: false }),
    })

    expect(screen.getByText('Grok is not installed')).toBeTruthy()
  })

  it('renders authentication recovery when Grok is installed but not authenticated', () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'grok', grokInstalled: true, grokAuthenticated: false }),
    })

    expect(screen.getByText('Grok needs authentication')).toBeTruthy()
    expect(screen.getByText(/xai_api_key/i)).toBeTruthy()
  })

  it('renders authentication recovery when Claude Code is installed but not authenticated', () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'claude-code', claudeInstalled: true, claudeAuthenticated: false }),
    })

    expect(screen.getByText('Claude Code needs authentication')).toBeTruthy()
    expect(screen.getByText(/run claude login/i)).toBeTruthy()
  })

  it('does not offer unauthenticated Claude Code as a recovery switch target', () => {
    render(ProviderSelectField, {
      props: defaultProps({
        aiProvider: 'pi',
        piInstalled: false,
        claudeInstalled: true,
        claudeAuthenticated: false,
      }),
    })

    expect(screen.queryByRole('button', { name: /switch to claude code/i })).toBeNull()
  })

  it('uses native disabled semantics for the provider select when disabled', () => {
    render(ProviderSelectField, { props: defaultProps({ disabled: true }) })

    expect(requireElement(screen.getByRole('combobox'), HTMLSelectElement).disabled).toBe(true)
  })

  describe('provider availability gating', () => {
    function optionByValue(value: string) {
      const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
      const option = Array.from(select.options).find((o) => o.value === value)
      if (!option) throw new Error(`Option for provider "${value}" not found`)
      return option
    }

    it('disables not-installed providers and keeps installed ones selectable', () => {
      render(ProviderSelectField, {
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
      render(ProviderSelectField, {
        props: defaultProps({ claudeInstalled: true, claudeAuthenticated: false }),
      })

      expect(optionByValue('claude-code').disabled).toBe(false)
    })

    it('labels a not-installed provider option to explain why it is unavailable', () => {
      render(ProviderSelectField, {
        props: defaultProps({ opencodeInstalled: false, claudeInstalled: true }),
      })

      expect(optionByValue('opencode').textContent).toMatch(/not installed/i)
      expect(optionByValue('claude-code').textContent).not.toMatch(/not installed/i)
    })

    it('does not disable any option while install status is still loading', () => {
      render(ProviderSelectField, {
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
      render(ProviderSelectField, {
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
      const onChange = vi.fn()
      render(ProviderSelectField, {
        props: defaultProps({
          aiProvider: 'claude-code',
          claudeInstalled: true,
          opencodeInstalled: false,
          onChange,
        }),
      })

      const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
      await fireEvent.change(select, { target: { value: 'opencode' } })

      expect(onChange).not.toHaveBeenCalled()
    })

    it('still applies selection of an installed provider', async () => {
      const onChange = vi.fn()
      render(ProviderSelectField, {
        props: defaultProps({
          aiProvider: 'claude-code',
          claudeInstalled: true,
          piInstalled: true,
          piVersion: '1.2.3',
          onChange,
        }),
      })

      const select = requireElement(screen.getByRole('combobox'), HTMLSelectElement)
      await fireEvent.change(select, { target: { value: 'pi' } })

      expect(onChange).toHaveBeenCalledWith('pi')
    })
  })

  describe('install links for not-installed providers', () => {
    beforeEach(() => {
      vi.mocked(openUrl).mockClear()
    })

    it('opens the install site for a not-installed provider', async () => {
      render(ProviderSelectField, { props: defaultProps({ opencodeInstalled: false }) })

      await fireEvent.click(screen.getByRole('button', { name: /install opencode/i }))

      expect(openUrl).toHaveBeenCalledWith('https://opencode.ai')
    })

    it('opens the Pi quickstart for a not-installed Pi', async () => {
      render(ProviderSelectField, { props: defaultProps({ piInstalled: false }) })

      await fireEvent.click(screen.getByRole('button', { name: /install pi/i }))

      expect(openUrl).toHaveBeenCalledWith('https://pi.dev/docs/latest/quickstart')
    })

    it('does not show an install link for an installed provider', () => {
      render(ProviderSelectField, {
        props: defaultProps({ claudeInstalled: true, claudeVersion: '1.0.0' }),
      })

      expect(screen.queryByRole('button', { name: /install claude code/i })).toBeNull()
    })
  })
})
