import { writable, type Writable } from 'svelte/store'

// Collapsed/expanded state for `CollapsibleSection`. State is GLOBAL (one map shared by
// every task, project, and plugin), keyed by a stable section key, and persisted to
// localStorage so it survives reloads. Default is expanded: a section key is only
// present here once the user has collapsed it.
//
// Host sections use bare keys ('details', 'initial-prompt'). Plugin sections must go
// through `pluginSectionKey` so two plugins cannot fight over the same generic name.

export type CollapsedSectionsState = Record<string, boolean>

// The store started life in the host app as src/lib/infoPanelSectionState.ts. The key is
// deliberately unchanged: renaming it would reset every user's collapsed sections.
export const COLLAPSED_SECTIONS_STORAGE_KEY = 'openforge.infoPanelSectionCollapse.v1'

const SHARED_STATE_SYMBOL = Symbol.for('com.openforge.plugin-sdk.collapsible-section-state.v1')

interface SharedCollapsedSectionsState {
  store: Writable<CollapsedSectionsState>
}

export function pluginSectionKey(pluginId: string, sectionKey: string): string {
  return `plugin:${pluginId}:${sectionKey}`
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readPersisted(fallback: CollapsedSectionsState = {}): CollapsedSectionsState {
  const storage = getLocalStorage()
  if (storage === null) return fallback

  try {
    const rawValue = storage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)
    if (rawValue === null) return {}
    const parsed = JSON.parse(rawValue)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const state: CollapsedSectionsState = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) state[key] = true
    }
    return state
  } catch {
    return fallback
  }
}

function writePersisted(state: CollapsedSectionsState): void {
  const storage = getLocalStorage()
  if (storage === null) return

  try {
    // Only persist collapsed sections; expanded is the default and needs no entry.
    const collapsedOnly: CollapsedSectionsState = {}
    for (const [key, value] of Object.entries(state)) {
      if (value === true) collapsedOnly[key] = true
    }

    if (Object.keys(collapsedOnly).length === 0) {
      storage.removeItem(COLLAPSED_SECTIONS_STORAGE_KEY)
      return
    }
    storage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(collapsedOnly))
  } catch {
    // Persistence is best effort and must not block the section from rendering.
  }
}

function updatePersistedSection(
  current: CollapsedSectionsState,
  key: string,
  collapsed: boolean,
): CollapsedSectionsState {
  // localStorage is the cross-realm source of truth. Re-read it for every mutation so
  // a bundle that cannot share this page's singleton still cannot overwrite newer keys.
  const next = { ...readPersisted(current) }
  if (collapsed) next[key] = true
  else delete next[key]
  writePersisted(next)
  return next
}

function getSharedState(): SharedCollapsedSectionsState {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: SharedCollapsedSectionsState | undefined
  }
  const existing = registry[SHARED_STATE_SYMBOL]
  if (existing !== undefined) return existing

  // Trusted Plugin bundles contain their own copy of this module. Symbol.for gives those
  // copies and the host one live access to the same Svelte store in this renderer realm.
  const shared = { store: writable<CollapsedSectionsState>(readPersisted()) }
  registry[SHARED_STATE_SYMBOL] = shared
  return shared
}

const { subscribe, set, update } = getSharedState().store

export const collapsedSections = { subscribe }

export function isSectionCollapsed(state: CollapsedSectionsState, key: string): boolean {
  return state[key] === true
}

export function setSectionCollapsed(key: string, collapsed: boolean): void {
  update((current) => updatePersistedSection(current, key, collapsed))
}

export function toggleSection(key: string): void {
  update((current) => {
    const latest = readPersisted(current)
    return updatePersistedSection(latest, key, !isSectionCollapsed(latest, key))
  })
}

export function clearCollapsedSections(): void {
  writePersisted({})
  set({})
}
