import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsGeneralCard from './SettingsGeneralCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'Test Project',
    projectPath: '/tmp/test',
    disabled: false,
    onProjectNameChange: vi.fn(),
    onProjectPathChange: vi.fn(),
    ...overrides,
  }
}

describe('SettingsGeneralCard', () => {
  it('renders General heading', () => {
    render(SettingsGeneralCard, { props: defaultProps() })

    expect(screen.getByText('General')).toBeTruthy()
  })

  it('is limited to project identity fields, delegating inherited settings elsewhere', () => {
    render(SettingsGeneralCard, { props: defaultProps() })

    // AI provider and the default-worktree toggle moved to the Configuration card;
    // the General card no longer owns any globally-inherited setting.
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByLabelText('Default new tasks to worktrees')).toBeNull()
  })

  it('does not expose project color controls', () => {
    render(SettingsGeneralCard, { props: defaultProps() })

    expect(screen.queryByRole('radiogroup', { name: 'Project Color' })).toBeNull()
  })
  it('uses native disabled semantics for form controls when disabled', () => {
    render(SettingsGeneralCard, { props: defaultProps({ disabled: true }) })

    expect(requireElement(screen.getByLabelText('Project Name'), HTMLInputElement).disabled).toBe(true)
    expect(requireElement(screen.getByLabelText('Project Path'), HTMLInputElement).disabled).toBe(true)
  })
})
