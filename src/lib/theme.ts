import { derived, writable, type Readable } from 'svelte/store'
import { getConfig, setConfig } from './ipc'
import {
  BUILTIN_DARK_THEME_ID,
  BUILTIN_LIGHT_THEME_ID,
  LIGHT_THEME,
} from './themeContract'
import { createThemeDocumentAdapter } from './themeDocumentAdapter'
import {
  createThemeRegistry,
  type ThemeDiagnostic,
  type ThemeRegistry,
} from './themeRegistry'

export type ThemeMode = 'light' | 'dark'

interface ThemeRuntimeOptions {
  root: HTMLElement
  getStoredThemeId(): Promise<string | null>
  persistThemeId(themeId: string): Promise<void>
  reportDiagnostic?: (diagnostic: ThemeDiagnostic) => void
  logError?: (message: string, error: unknown) => void
}

export interface ThemeRuntime {
  readonly registry: ThemeRegistry
  readonly themeMode: Readable<ThemeMode>
  initialize(): Promise<void>
  applyTheme(mode: ThemeMode): Promise<void>
}

function migrateStoredThemeId(storedThemeId: string | null): string {
  if (storedThemeId === 'light' || storedThemeId === null) return BUILTIN_LIGHT_THEME_ID
  if (storedThemeId === 'dark') return BUILTIN_DARK_THEME_ID
  return storedThemeId
}

export function createThemeRuntime(options: ThemeRuntimeOptions): ThemeRuntime {
  const adapter = createThemeDocumentAdapter(options.root)
  adapter.apply(LIGHT_THEME)

  const registry = createThemeRegistry({
    applyTheme: adapter.apply,
    persistSelection: options.persistThemeId,
    reportDiagnostic: options.reportDiagnostic,
  })
  const themeMode = derived(registry.selectedTheme, (theme) => theme.appearance)
  const logError = options.logError ?? ((message: string, error: unknown) => {
    console.error(message, error)
  })
  let initialization: Promise<void> | null = null

  function initialize(): Promise<void> {
    if (initialization) return initialization
    initialization = (async () => {
      let storedThemeId: string | null = null
      try {
        storedThemeId = await options.getStoredThemeId()
      } catch (error) {
        logError('Failed to load saved theme:', error)
      }
      await registry.selectTheme(migrateStoredThemeId(storedThemeId))
    })()
    return initialization
  }

  async function applyLegacyTheme(mode: ThemeMode): Promise<void> {
    await registry.selectTheme(
      mode === 'dark' ? BUILTIN_DARK_THEME_ID : BUILTIN_LIGHT_THEME_ID,
    )
  }

  return Object.freeze({
    registry,
    themeMode,
    initialize,
    applyTheme: applyLegacyTheme,
  })
}

const themeDiagnosticStore = writable<readonly ThemeDiagnostic[]>([])
export const themeDiagnostics: Readable<readonly ThemeDiagnostic[]> = {
  subscribe: themeDiagnosticStore.subscribe,
}

function recordThemeDiagnostic(diagnostic: ThemeDiagnostic): void {
  themeDiagnosticStore.update((current) => Object.freeze([...current, diagnostic]))
  console.warn(
    `Theme "${diagnostic.themeId}" is unavailable; using ${diagnostic.fallbackThemeId}.`,
  )
}

const globalThemeRuntime = createThemeRuntime({
  root: document.documentElement,
  getStoredThemeId: () => getConfig('theme'),
  persistThemeId: (themeId) => setConfig('theme', themeId),
  reportDiagnostic: recordThemeDiagnostic,
})

export const themeRegistry = globalThemeRuntime.registry
export const themeMode = globalThemeRuntime.themeMode
export const availableThemes = themeRegistry.availableThemes
export const selectedTheme = themeRegistry.selectedTheme

/** Legacy light/dark adapter retained while settings callers migrate to stable ids. */
export function applyTheme(mode: ThemeMode): void {
  void globalThemeRuntime.applyTheme(mode).catch((error) => {
    console.error('Failed to apply theme:', error)
  })
}

/** Resolve persisted theme identity after app-level plugin activation completes. */
export function initTheme(): Promise<void> {
  return globalThemeRuntime.initialize()
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
