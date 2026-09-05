import { render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHT_THEME } from '../../lib/themeContract'
import { activeProjectId, error, projects } from '../../lib/stores'
import { get } from 'svelte/store'
import { themeRegistry, themeDiagnostics } from '../../lib/theme'
import { chooseSelectOption, openSelect } from '../../test-utils/select'
import { defaultProps } from './SettingsView.testUtils'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'
import SettingsView from './SettingsView.svelte'
import ToastHost from '../feedback/toasts/ToastHost.svelte'

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
    error.set(null)
    resetSettingsViewRenderIpc()
    activeProjectId.set(null)
    projects.set([])
  })

  afterEach(async () => {
    await themeRegistry.selectTheme(LIGHT_THEME.id)
    error.set(null)
  })

  it('reflects external selection and diagnoses an unavailable theme without an autosave overwrite', async () => {
    render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
    const select = await screen.findByRole('button', { name: 'Theme' })
    await themeRegistry.selectTheme('openforge-dark')
    await vi.waitFor(() => expect(select.textContent).toContain('OpenForge Dark'))
    await themeRegistry.selectTheme('com.example.missing:theme')
    await vi.waitFor(() => expect(select.textContent).toContain('OpenForge Light'))
    expect(themeIpc.setConfig).toHaveBeenLastCalledWith('theme', LIGHT_THEME.id)
    expect(get(themeDiagnostics).at(-1)).toMatchObject({
      themeId: 'com.example.missing:theme', fallbackThemeId: LIGHT_THEME.id, reason: 'invalid-or-unavailable',
    })
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

    const select = await screen.findByRole('button', { name: 'Theme' })
    await openSelect(select)
    expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toContain(
      'Paper — Provided by com.example.paper',
    )

    themeIpc.setConfig.mockClear()
    await chooseSelectOption(select, /Paper/)

    await vi.waitFor(() => {
      expect(select.textContent).toContain('Paper')
      expect(themeIpc.setConfig).toHaveBeenCalledWith('theme', 'com.example.paper:paper')
    })

    themeIpc.setConfig.mockClear()
    await registration.dispose()

    await vi.waitFor(() => {
      expect(select.textContent).toContain('OpenForge Light')
      expect(screen.queryByRole('option', { name: /Paper/ })).toBeNull()
      expect(themeIpc.setConfig).toHaveBeenCalledWith('theme', LIGHT_THEME.id)
      expect(get(themeDiagnostics).at(-1)).toMatchObject({ themeId: 'com.example.paper:paper', reason: 'unregistered' })
    })
  })

  it.each(['load', 'error'])('keeps the committed selection visible until theme CSS finishes with %s', async outcome => {
    const id = 'com.example.css:paper'
    const registration = themeRegistry.registerContributedTheme({
      ...LIGHT_THEME, id, label: 'CSS Paper', stylesheets: ['paper.css'],
    }, { pluginId: 'com.example.css', generation: 0 })
    try {
      render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })
      render(ToastHost)
      const select = await screen.findByRole('button', { name: 'Theme' })
      themeIpc.setConfig.mockClear()
      await chooseSelectOption(select, /CSS Paper/)
      expect(select.textContent).toContain('OpenForge Light')
      expect(themeIpc.setConfig).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(document.querySelector('link[data-openforge-theme-stylesheet]')).not.toBeNull())
      document.querySelector('link[data-openforge-theme-stylesheet]')!.dispatchEvent(new Event(outcome))
      if (outcome === 'load') {
        await vi.waitFor(() => expect(select.textContent).toContain('CSS Paper'))
        expect(themeIpc.setConfig).toHaveBeenCalledWith('theme', id)
      } else {
        await vi.waitFor(() => expect(screen.getByText(/Plugin com.example.css.*failed to load stylesheet/)).toBeTruthy())
        expect(select.textContent).toContain('OpenForge Light')
        expect(themeIpc.setConfig).not.toHaveBeenCalled()
      }
    } finally {
      await registration.dispose()
    }
  })
})
