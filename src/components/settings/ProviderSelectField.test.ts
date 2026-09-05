import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chooseSelectOption, openSelect } from '../../test-utils/select'
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
  it('renders provider options', async () => {
    render(ProviderSelectField, { props: defaultProps() })

    const select = requireElement(screen.getByRole('button', { name: 'AI Provider' }), HTMLButtonElement)
    await openSelect(select)
    expect(screen.getAllByRole('option').map(option => option.textContent?.trim())).toEqual([
      'Claude Code', 'OpenCode — not installed', 'Pi Coding Agent — not installed', 'Codex — not installed', 'Grok — not installed',
    ])
  })

  it('renders Pi installed status', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ piInstalled: true, piVersion: '1.2.3' }),
    })

    expect(screen.getByText('Pi 1.2.3')).toBeTruthy()
  })

  it('renders Pi not installed status', async () => {
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

  it('renders Codex installed status', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ codexInstalled: true, codexVersion: 'codex-cli 0.137.0' }),
    })

    expect(screen.getByText('Codex codex-cli 0.137.0')).toBeTruthy()
  })

  it('renders Codex not installed status', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ codexInstalled: false, codexVersion: null }),
    })

    expect(screen.getByText('Codex not installed')).toBeTruthy()
  })

  it('renders warning when selected provider is Codex and not installed', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'codex', codexInstalled: false }),
    })

    expect(screen.getByText('Codex is not installed')).toBeTruthy()
  })

  it('renders Grok installed status', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ grokInstalled: true, grokVersion: 'grok-cli 0.1.0' }),
    })

    expect(screen.getByText('Grok grok-cli 0.1.0')).toBeTruthy()
  })

  it('renders Grok not installed status', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ grokInstalled: false, grokVersion: null }),
    })

    expect(screen.getByText('Grok not installed')).toBeTruthy()
  })

  it('renders warning when selected provider is Grok and not installed', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'grok', grokInstalled: false }),
    })

    expect(screen.getByText('Grok is not installed')).toBeTruthy()
  })

  it('renders authentication recovery when Grok is installed but not authenticated', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'grok', grokInstalled: true, grokAuthenticated: false }),
    })

    expect(screen.getByText('Grok needs authentication')).toBeTruthy()
    expect(screen.getByText(/xai_api_key/i)).toBeTruthy()
  })

  it('renders authentication recovery when Claude Code is installed but not authenticated', async () => {
    render(ProviderSelectField, {
      props: defaultProps({ aiProvider: 'claude-code', claudeInstalled: true, claudeAuthenticated: false }),
    })

    expect(screen.getByText('Claude Code needs authentication')).toBeTruthy()
    expect(screen.getByText(/run claude login/i)).toBeTruthy()
  })

  it('does not offer unauthenticated Claude Code as a recovery switch target', async () => {
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

  it('uses native disabled semantics for the provider select when disabled', async () => {
    render(ProviderSelectField, { props: defaultProps({ disabled: true }) })

    expect(requireElement(screen.getByRole('button', { name: 'AI Provider' }), HTMLButtonElement).disabled).toBe(true)
  })

  describe('provider availability gating', () => {
    async function optionByValue(value: string) {
      await openSelect(screen.getByRole('button', { name: 'AI Provider' }))
      const names: Record<string, RegExp> = {
        'claude-code': /^Claude Code/, opencode: /^OpenCode/, pi: /^Pi Coding Agent/, codex: /^Codex/, grok: /^Grok/,
      }
      return screen.getByRole('option', { name: names[value] })
    }

    it('disables not-installed providers and keeps installed ones selectable', async () => {
      render(ProviderSelectField, {
        props: defaultProps({
          claudeInstalled: true,
          claudeAuthenticated: true,
          opencodeInstalled: false,
          piInstalled: false,
          codexInstalled: false,
        }),
      })

      expect((await optionByValue('claude-code')).getAttribute('aria-disabled')).not.toBe('true')
      expect((await optionByValue('opencode')).getAttribute('aria-disabled')).toBe('true')
      expect((await optionByValue('pi')).getAttribute('aria-disabled')).toBe('true')
      expect((await optionByValue('codex')).getAttribute('aria-disabled')).toBe('true')
    })

    it('keeps installed-but-unauthenticated Claude Code selectable', async () => {
      render(ProviderSelectField, {
        props: defaultProps({ claudeInstalled: true, claudeAuthenticated: false }),
      })

      expect((await optionByValue('claude-code')).getAttribute('aria-disabled')).not.toBe('true')
    })

    it('labels a not-installed provider option to explain why it is unavailable', async () => {
      render(ProviderSelectField, {
        props: defaultProps({ opencodeInstalled: false, claudeInstalled: true }),
      })

      expect((await optionByValue('opencode')).textContent).toMatch(/not installed/i)
      expect((await optionByValue('claude-code')).textContent).not.toMatch(/not installed/i)
    })

    it('does not disable any option while install status is still loading', async () => {
      render(ProviderSelectField, {
        props: defaultProps({
          installationStatusLoading: true,
          opencodeInstalled: false,
          piInstalled: false,
          codexInstalled: false,
        }),
      })

      expect((await optionByValue('opencode')).getAttribute('aria-disabled')).not.toBe('true')
      expect((await optionByValue('pi')).getAttribute('aria-disabled')).not.toBe('true')
      expect((await optionByValue('codex')).getAttribute('aria-disabled')).not.toBe('true')
    })

    it('does not disable any option when the install status check errored', async () => {
      render(ProviderSelectField, {
        props: defaultProps({
          installationStatusError: 'spawn check failed',
          opencodeInstalled: false,
          piInstalled: false,
          codexInstalled: false,
        }),
      })

      expect((await optionByValue('opencode')).getAttribute('aria-disabled')).not.toBe('true')
      expect((await optionByValue('pi')).getAttribute('aria-disabled')).not.toBe('true')
      expect((await optionByValue('codex')).getAttribute('aria-disabled')).not.toBe('true')
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

      const select = requireElement(screen.getByRole('button', { name: 'AI Provider' }), HTMLButtonElement)
      await chooseSelectOption(select, /^OpenCode/)

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

      const select = requireElement(screen.getByRole('button', { name: 'AI Provider' }), HTMLButtonElement)
      await chooseSelectOption(select, /^Pi Coding Agent/)

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

    it('does not show an install link for an installed provider', async () => {
      render(ProviderSelectField, {
        props: defaultProps({ claudeInstalled: true, claudeVersion: '1.0.0' }),
      })

      expect(screen.queryByRole('button', { name: /install claude code/i })).toBeNull()
    })
  })
})
