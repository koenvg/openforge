import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHT_THEME } from '../../lib/themeContract'
import { activeProjectId, projects } from '../../lib/stores'
import { themeRegistry } from '../../lib/theme'
import { requireElement } from '../../test-utils/dom'
import { defaultProps } from './SettingsView.testUtils'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'
import SettingsView from './SettingsView.svelte'

const themeIpc = vi.hoisted(() => ({
  setConfig: vi.fn(async () => undefined),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...themeIpc }
})

describe('SettingsView theme selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSettingsViewRenderIpc()
    activeProjectId.set(null)
    projects.set([])
  })

  afterEach(async () => {
    await themeRegistry.selectTheme(LIGHT_THEME.id)
  })

  it('lists registry themes, persists stable selection, and reflects contribution fallback', async () => {
    const registration = themeRegistry.registerContributedTheme({
      ...LIGHT_THEME,
      id: 'com.example.paper:paper',
      label: 'Paper',
      tokens: { ...LIGHT_THEME.tokens, canvas: '#FAF7F0' },
    }, {
      pluginId: 'com.example.paper',
      generation: 1,
    })

    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    const select = requireElement(await screen.findByRole('combobox', { name: 'Theme' }), HTMLSelectElement)
    expect(Array.from(select.options).map((option) => option.textContent)).toContain(
      'Paper — Provided by com.example.paper',
    )

    themeIpc.setConfig.mockClear()
    await fireEvent.change(select, { target: { value: 'com.example.paper:paper' } })

    await vi.waitFor(() => {
      expect(select.value).toBe('com.example.paper:paper')
      expect(themeIpc.setConfig).toHaveBeenCalledWith('theme', 'com.example.paper:paper')
    })

    themeIpc.setConfig.mockClear()
    await registration.dispose()

    await vi.waitFor(() => {
      expect(select.value).toBe(LIGHT_THEME.id)
      expect(screen.queryByRole('option', { name: /Paper/ })).toBeNull()
      expect(themeIpc.setConfig).toHaveBeenCalledWith('theme', LIGHT_THEME.id)
    })
  })
})
