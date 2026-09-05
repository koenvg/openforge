import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { chooseSelectOption } from '../../test-utils/select'
import SettingsMigrationFixture from './SettingsMigration.testFixture.svelte'

describe.each(['OpenForge Light', 'OpenForge Dark', 'Ink'])('settings under %s', (theme) => {
  it('retains edited fields, switch state, and expanded instructions when the theme changes', async () => {
    render(SettingsMigrationFixture)
    const name = screen.getByRole('textbox', { name: 'Project Name' })
    await fireEvent.input(name, { target: { value: 'Edited project' } })
    const toggle = screen.getByRole('switch', { name: 'Default new tasks to worktrees' })
    await fireEvent.click(toggle)
    const expand = screen.getByRole('button', { name: 'Expand AI Review Instructions' })
    await fireEvent.click(expand)
    const instructions = screen.getByRole('textbox', { name: 'AI Review Instructions' })
    await fireEvent.input(instructions, { target: { value: 'Check public compatibility.' } })

    await chooseSelectOption(screen.getByRole('button', { name: 'Theme' }), new RegExp(`^${theme}`))

    expect(screen.getByRole('textbox', { name: 'Project Name' })).toBe(name)
    expect(name).toHaveProperty('value', 'Edited project')
    expect(toggle).toHaveProperty('checked', false)
    expect(instructions).toHaveProperty('value', 'Check public compatibility.')
    expect(screen.getByRole('button', { name: 'Collapse AI Review Instructions' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toContain(theme)
  })
})
