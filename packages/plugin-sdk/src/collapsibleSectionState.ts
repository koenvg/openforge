import { writable } from 'svelte/store'

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

function readPersisted(): CollapsedSectionsState {
  const storage = getLocalStorage()
  if (storage === null) return {}

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
    return {}
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

const { subscribe, set, update } = writable<CollapsedSectionsState>(readPersisted())

export const collapsedSections = { subscribe }

export function isSectionCollapsed(state: CollapsedSectionsState, key: string): boolean {
  return state[key] === true
}

export function setSectionCollapsed(key: string, collapsed: boolean): void {
  update((current) => {
    const next = { ...current, [key]: collapsed }
    writePersisted(next)
    return next
  })
}

export function toggleSection(key: string): void {
  update((current) => {
    const next = { ...current, [key]: !isSectionCollapsed(current, key) }
    writePersisted(next)
    return next
  })
}

export function clearCollapsedSections(): void {
  writePersisted({})
  set({})
}
