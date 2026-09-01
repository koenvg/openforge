import { derived, get, writable, type Readable } from 'svelte/store'
import {
  BUILTIN_LIGHT_THEME_ID,
  BUILTIN_THEMES,
  freezeThemeDefinition,
  type ThemeDefinition,
} from './themeContract'

export interface PluginThemeOwner {
  readonly pluginId: string
  readonly generation: number
}

export type ThemeOwner =
  | { readonly kind: 'builtin' }
  | ({ readonly kind: 'plugin' } & PluginThemeOwner)

export interface RegisteredTheme extends ThemeDefinition {
  readonly owner: ThemeOwner
}

export interface ThemeRegistrySnapshot {
  readonly availableThemes: readonly RegisteredTheme[]
  readonly selectedTheme: RegisteredTheme
}

export interface ThemeDiagnostic {
  readonly code: 'theme-unavailable'
  readonly themeId: string
  readonly fallbackThemeId: typeof BUILTIN_LIGHT_THEME_ID
  readonly reason: 'invalid-or-unavailable' | 'unregistered'
}

export interface ThemeRegistration {
  dispose(): Promise<void>
}

interface ThemeRegistryOptions {
  applyTheme?: (theme: RegisteredTheme) => void | Promise<void>
  persistSelection?: (themeId: string) => void | Promise<void>
  reportDiagnostic?: (diagnostic: ThemeDiagnostic) => void
}

function asRegisteredTheme(definition: ThemeDefinition, owner: ThemeOwner): RegisteredTheme {
  const frozenDefinition = freezeThemeDefinition(definition)
  return Object.freeze({
    ...frozenDefinition,
    owner: Object.freeze({ ...owner }),
  })
}

function freezeSnapshot(
  themes: Iterable<RegisteredTheme>,
  selectedTheme: RegisteredTheme,
): ThemeRegistrySnapshot {
  return Object.freeze({
    availableThemes: Object.freeze(Array.from(themes)),
    selectedTheme,
  })
}

export function createThemeRegistry(options: ThemeRegistryOptions = {}) {
  const themesById = new Map<string, RegisteredTheme>()
  for (const theme of BUILTIN_THEMES) {
    themesById.set(theme.id, asRegisteredTheme(theme, { kind: 'builtin' }))
  }

  const builtInLight = themesById.get(BUILTIN_LIGHT_THEME_ID)
  if (!builtInLight) throw new Error('Built-in light theme is not registered')
  const fallbackTheme: RegisteredTheme = builtInLight

  const snapshotStore = writable(freezeSnapshot(themesById.values(), fallbackTheme))
  let operation = Promise.resolve()

  function publish(selectedTheme: RegisteredTheme, themes = themesById.values()): void {
    snapshotStore.set(freezeSnapshot(themes, selectedTheme))
  }

  function reportUnavailable(themeId: string, reason: ThemeDiagnostic['reason']): void {
    options.reportDiagnostic?.({
      code: 'theme-unavailable',
      themeId,
      fallbackThemeId: BUILTIN_LIGHT_THEME_ID,
      reason,
    })
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = operation.then(work, work)
    operation = result.then(() => undefined, () => undefined)
    return result
  }

  async function applySelection(theme: RegisteredTheme): Promise<void> {
    await options.applyTheme?.(theme)
    publish(theme)
  }

  function selectTheme(themeId: string): Promise<RegisteredTheme> {
    return enqueue(async () => {
      const requested = themesById.get(themeId)
      const selected = requested ?? fallbackTheme
      await applySelection(selected)
      if (!requested) reportUnavailable(themeId, 'invalid-or-unavailable')
      await options.persistSelection?.(selected.id)
      return selected
    })
  }

  function registerContributedTheme(
    definition: ThemeDefinition,
    owner: PluginThemeOwner,
  ): ThemeRegistration {
    if (!definition.id.startsWith(`${owner.pluginId}:`)) {
      throw new Error(`Contributed theme id must be qualified by ${owner.pluginId}`)
    }
    if (themesById.has(definition.id)) {
      throw new Error(`Theme id already registered: ${definition.id}`)
    }

    const registered = asRegisteredTheme(definition, {
      kind: 'plugin',
      pluginId: owner.pluginId,
      generation: owner.generation,
    })
    themesById.set(registered.id, registered)
    publish(get(snapshotStore).selectedTheme)
    let disposed = false

    return Object.freeze({
      dispose(): Promise<void> {
        if (disposed) return Promise.resolve()
        disposed = true
        return enqueue(async () => {
          if (themesById.get(registered.id) !== registered) return
          const current = get(snapshotStore)
          if (current.selectedTheme !== registered) {
            themesById.delete(registered.id)
            publish(current.selectedTheme)
            return
          }

          await options.applyTheme?.(fallbackTheme)
          themesById.delete(registered.id)
          publish(fallbackTheme)
          reportUnavailable(registered.id, 'unregistered')
          await options.persistSelection?.(fallbackTheme.id)
        })
      },
    })
  }

  const snapshot: Readable<ThemeRegistrySnapshot> = { subscribe: snapshotStore.subscribe }
  const availableThemes = derived(snapshotStore, (value) => value.availableThemes)
  const selectedTheme = derived(snapshotStore, (value) => value.selectedTheme)

  return Object.freeze({
    snapshot,
    availableThemes,
    selectedTheme,
    selectTheme,
    registerContributedTheme,
  })
}

export type ThemeRegistry = ReturnType<typeof createThemeRegistry>
