import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSettingsViewCompanionTest } from './SettingsView.companion.testFixture'
import { defaultProps } from './SettingsView.testUtils'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

describe('SettingsView Companion integration', () => {
  beforeEach(resetSettingsViewCompanionTest)

  it('renders the opt-in Companion section on the global page', async () => {
    activeProjectId.set(null)
    projects.set([])
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    await fireEvent.click(screen.getByRole('button', { name: /Companion/ }))
    expect(screen.getByRole('main', { name: 'Global settings' }).textContent).toContain('Companion')
    expect(screen.getByRole('button', { name: 'Enable Companion Gateway' })).toBeTruthy()
  })
})
