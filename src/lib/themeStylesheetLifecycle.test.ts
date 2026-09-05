import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { createThemeRuntime } from './theme'
import { DARK_THEME, LIGHT_THEME } from './themeContract'

vi.mock('./ipc', () => ({ getConfig: vi.fn(), setConfig: vi.fn() }))

const pluginId = 'acme.themes'
const themeId = `${pluginId}:ink`

function runtime() {
  const root = document.createElement('main')
  document.body.append(root)
  const persistThemeId = vi.fn(async (_id: string) => undefined)
  const host = createThemeRuntime({
    root,
    getStoredThemeId: async () => null,
    persistThemeId,
  })
  const registration = host.registry.registerContributedTheme({
    ...DARK_THEME,
    id: themeId,
    stylesheets: ['./dist/ink.css', 'dist/accents.css'],
  }, { pluginId, generation: 7 })
  return { ...host, root, persistThemeId, registration }
}

function links(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll('link[data-openforge-theme-stylesheet]'))
}

async function candidates() {
  await vi.waitFor(() => expect(links()).toHaveLength(2))
  return links()
}

afterEach(() => {
  for (const link of links()) link.remove()
  document.body.replaceChildren()
})

describe('selected theme stylesheets', () => {
  it('resolves plugin assets and keeps candidates inactive until all files can commit with tokens and identity', async () => {
    const { registry, root, persistThemeId } = runtime()
    expect(links()).toEqual([])
    const selection = registry.selectTheme(themeId)
    const [ink, accents] = await candidates()
    expect(ink.href).toBe('plugin://acme.themes/dist/ink.css?openforgeReload=7')
    expect(accents.href).toBe('plugin://acme.themes/dist/accents.css?openforgeReload=7')
    expect(links().every(link => link.media === 'not all')).toBe(true)

    ink.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    expect(root.dataset.themeAppearance).toBe('light')
    expect(root.style.getPropertyValue('--of-canvas')).toBe(LIGHT_THEME.tokens.canvas)
    expect(get(registry.selectedTheme).id).toBe(LIGHT_THEME.id)
    expect(persistThemeId).not.toHaveBeenCalled()

    const observed: string[] = []
    const unsubscribe = registry.selectedTheme.subscribe(theme => {
      if (theme.id !== themeId) return
      expect(root.dataset.theme).toBe(themeId)
      expect(root.dataset.themeAppearance).toBe('dark')
      expect(root.style.getPropertyValue('--of-canvas')).toBe(DARK_THEME.tokens.canvas)
      expect(links().every(link => link.media === 'all')).toBe(true)
      observed.push(theme.id)
    })
    accents.dispatchEvent(new Event('load'))
    await selection
    unsubscribe()
    expect(observed).toEqual([themeId])
    expect(persistThemeId).toHaveBeenLastCalledWith(themeId)
  })

  it('cancels an in-flight generation on unregister without waiting for load events', async () => {
    const { registry, root, registration, persistThemeId } = runtime()
    const pending = registry.selectTheme(themeId)
    const stale = await candidates()
    await registration.dispose()
    await pending
    expect(links()).toEqual([])
    expect(get(registry.availableThemes).some(theme => theme.id === themeId)).toBe(false)
    expect(persistThemeId).not.toHaveBeenCalled()
    registry.registerContributedTheme({
      ...LIGHT_THEME, id: themeId, stylesheets: ['dist/new.css'],
    }, { pluginId, generation: 8 })
    const freshSelection = registry.selectTheme(themeId)
    await vi.waitFor(() => expect(links()).toHaveLength(1))
    const fresh = links()[0]
    expect(fresh.href).toBe('plugin://acme.themes/dist/new.css?openforgeReload=8')
    for (const link of stale) link.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    expect(fresh.media).toBe('not all')
    fresh.dispatchEvent(new Event('load'))
    await freshSelection
    expect(root.dataset.theme).toBe(themeId)
    expect(links()).toEqual([fresh])
  })

  it('retains the active plugin CSS, tokens, appearance and preference when another theme fails to load', async () => {
    const { registry, root, persistThemeId } = runtime()
    const first = registry.selectTheme(themeId)
    const active = await candidates()
    for (const link of active) link.dispatchEvent(new Event('load'))
    await first
    registry.registerContributedTheme({
      ...LIGHT_THEME, id: 'other.theme:paper', stylesheets: ['dist/paper.css', 'dist/missing.css'],
    }, { pluginId: 'other.theme', generation: 1 })
    const failed = expect(registry.selectTheme('other.theme:paper'))
      .rejects.toThrow('Plugin other.theme theme other.theme:paper failed to load stylesheet dist/missing.css')
    await vi.waitFor(() => expect(links()).toHaveLength(4))
    const [, , paper, missing] = links()
    paper.dispatchEvent(new Event('load'))
    missing.dispatchEvent(new Event('error'))
    await failed
    expect(links()).toEqual(active)
    expect(active.every(link => link.media === 'all')).toBe(true)
    expect(root.dataset.theme).toBe(themeId)
    expect(root.dataset.themeAppearance).toBe('dark')
    expect(root.style.getPropertyValue('--of-canvas')).toBe(DARK_THEME.tokens.canvas)
    expect(get(registry.selectedTheme).id).toBe(themeId)
    expect(persistThemeId).toHaveBeenLastCalledWith(themeId)
    await registry.selectTheme(LIGHT_THEME.id)
    expect(links()).toEqual([])
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
  })

  it('allows switching away while CSS is still loading and ignores late events', async () => {
    const { registry, root, persistThemeId } = runtime()
    const pending = registry.selectTheme(themeId)
    const stale = await candidates()
    await registry.selectTheme(DARK_THEME.id)
    await pending
    for (const link of stale) link.dispatchEvent(new Event('load'))
    expect(links()).toEqual([])
    expect(root.dataset.theme).toBe(DARK_THEME.id)
    expect(persistThemeId).toHaveBeenLastCalledWith(DARK_THEME.id)
  })

  it('removes active CSS during fallback without cancelling an unrelated candidate', async () => {
    const { registry, root, registration } = runtime()
    const first = registry.selectTheme(themeId)
    for (const link of await candidates()) link.dispatchEvent(new Event('load'))
    await first
    registry.registerContributedTheme({
      ...LIGHT_THEME, id: 'other.theme:paper', stylesheets: ['dist/paper.css'],
    }, { pluginId: 'other.theme', generation: 0 })
    const next = registry.selectTheme('other.theme:paper')
    await vi.waitFor(() => expect(links()).toHaveLength(3))
    const candidate = links()[2]
    await registration.dispose()
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    expect(links()).toEqual([candidate])
    expect(candidate.media).toBe('not all')
    candidate.dispatchEvent(new Event('load'))
    await next
    expect(root.dataset.theme).toBe('other.theme:paper')
    expect(candidate.media).toBe('all')
  })

  it('fails a stalled stylesheet with the plugin owner instead of blocking selection forever', async () => {
    vi.useFakeTimers()
    try {
      const { registry, root } = runtime()
      const failed = expect(registry.selectTheme(themeId)).rejects.toThrow(/Plugin acme.themes.*timed out/)
      await vi.advanceTimersByTimeAsync(15_000)
      await failed
      expect(links()).toEqual([])
      expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not commit a ready candidate that is unregistered before its selection publishes', async () => {
    const { registry, registration, root, persistThemeId } = runtime()
    const pending = registry.selectTheme(themeId)
    for (const link of await candidates()) link.dispatchEvent(new Event('load'))
    await registration.dispose()
    await pending
    expect(links()).toEqual([])
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    expect(persistThemeId).not.toHaveBeenCalled()
  })
})
