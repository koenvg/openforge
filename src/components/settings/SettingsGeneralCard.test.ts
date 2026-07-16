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
    projectColor: '',
    disabled: false,
    onProjectNameChange: vi.fn(),
    onProjectPathChange: vi.fn(),
    onProjectColorChange: vi.fn(),
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
})
