import { render, screen, fireEvent } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsGeneralCard from './SettingsGeneralCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'Test Project',
    projectPath: '/tmp/test',
    aiProvider: 'claude-code',
    useWorktrees: true,
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
    onUseWorktreesChange: vi.fn(),
    onProjectColorChange: vi.fn(),
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
    expect(screen.getByRole('radio', { name: 'Default Gray project color' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'Rose project color' }).getAttribute('aria-checked')).toBe('true')
  })

  describe('git worktrees toggle', () => {
    it('renders Git Worktrees label', () => {
      render(SettingsGeneralCard, { props: defaultProps() })

      expect(screen.getByText('Git Worktrees')).toBeTruthy()
    })

    it('renders toggle checked when useWorktrees is true', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ useWorktrees: true }),
      })

      const toggle = requireElement(screen.getByTestId('use-worktrees-toggle'), HTMLInputElement)
      expect(toggle.checked).toBe(true)
    })

    it('renders toggle unchecked when useWorktrees is false', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ useWorktrees: false }),
      })

      const toggle = requireElement(screen.getByTestId('use-worktrees-toggle'), HTMLInputElement)
      expect(toggle.checked).toBe(false)
    })

    it('calls onUseWorktreesChange when toggle is clicked', async () => {
      const onUseWorktreesChange = vi.fn()
      render(SettingsGeneralCard, {
        props: defaultProps({ onUseWorktreesChange }),
      })

      const toggle = screen.getByTestId('use-worktrees-toggle')
      await fireEvent.click(toggle)

      expect(onUseWorktreesChange).toHaveBeenCalledOnce()
    })

    it('renders description text for worktrees toggle', () => {
      render(SettingsGeneralCard, { props: defaultProps() })

      expect(
        screen.getByText(
          'Run agents in isolated git worktrees. When disabled, agents work directly in the project directory.'
        )
      ).toBeTruthy()
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

    it('renders warning when selected provider is Pi and not installed', () => {
      render(SettingsGeneralCard, {
        props: defaultProps({ aiProvider: 'pi', piInstalled: false }),
      })

      expect(screen.getByText('Selected provider is not installed')).toBeTruthy()
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

      expect(screen.getByText('Selected provider is not installed')).toBeTruthy()
    })
  })
})
