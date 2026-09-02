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


export interface ThemeBatchRegistration extends ThemeRegistration {
  disposeTheme(themeId: string): Promise<void>
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

  function registerContributedThemes(
    definitions: readonly ThemeDefinition[],
    owner: PluginThemeOwner,
  ): ThemeBatchRegistration {
    const registeredById = new Map<string, RegisteredTheme>()
    for (const definition of definitions) {
      if (!definition.id.startsWith(`${owner.pluginId}:`)) {
        throw new Error(`Contributed theme id must be qualified by ${owner.pluginId}`)
      }
      if (registeredById.has(definition.id) || themesById.has(definition.id)) {
        throw new Error(`Theme id already registered: ${definition.id}`)
      }
      registeredById.set(definition.id, asRegisteredTheme(definition, {
        kind: 'plugin',
        pluginId: owner.pluginId,
        generation: owner.generation,
      }))
    }

    for (const registered of registeredById.values()) {
      themesById.set(registered.id, registered)
    }
    if (registeredById.size > 0) publish(get(snapshotStore).selectedTheme)

    function disposeIds(themeIds: readonly string[]): Promise<void> {
      return enqueue(async () => {
        const current = get(snapshotStore)
        const registrations = themeIds
          .map(themeId => registeredById.get(themeId))
          .filter((theme): theme is RegisteredTheme => theme !== undefined)
        const selectedRemoved = registrations.some(theme => current.selectedTheme === theme)

        if (selectedRemoved) await options.applyTheme?.(fallbackTheme)
        let changed = false
        for (const registered of registrations) {
          if (themesById.get(registered.id) !== registered) continue
          themesById.delete(registered.id)
          changed = true
        }
        if (!changed) return

        const selected = selectedRemoved ? fallbackTheme : current.selectedTheme
        publish(selected)
        if (selectedRemoved) {
          reportUnavailable(current.selectedTheme.id, 'unregistered')
          await options.persistSelection?.(fallbackTheme.id)
        }
      })
    }

    return Object.freeze({
      dispose: () => disposeIds(Array.from(registeredById.keys())),
      disposeTheme: (themeId: string) => disposeIds([themeId]),
    })
  }

  function registerContributedTheme(
    definition: ThemeDefinition,
    owner: PluginThemeOwner,
  ): ThemeRegistration {
    return registerContributedThemes([definition], owner)
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
    registerContributedThemes,
  })
}

export type ThemeRegistry = ReturnType<typeof createThemeRegistry>
