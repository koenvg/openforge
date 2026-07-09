import { writable } from 'svelte/store'

// Collapsed/expanded state for the task info side-panel sections. State is GLOBAL
// (one map shared by every task and project), keyed by a stable section key, and
// persisted to localStorage so it survives reloads. Default is expanded: a section
// key is only present here once the user has collapsed it.

export type InfoPanelSectionCollapseState = Record<string, boolean>

const storageKey = 'openforge.infoPanelSectionCollapse.v1'

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readPersisted(): InfoPanelSectionCollapseState {
  const storage = getLocalStorage()
  if (storage === null) return {}

  try {
    const rawValue = storage.getItem(storageKey)
    if (rawValue === null) return {}
    const parsed = JSON.parse(rawValue)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const state: InfoPanelSectionCollapseState = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) state[key] = true
    }
    return state
  } catch {
    return {}
  }
}

function writePersisted(state: InfoPanelSectionCollapseState): void {
  const storage = getLocalStorage()
  if (storage === null) return

  try {
    // Only persist collapsed sections; expanded is the default and needs no entry.
    const collapsedOnly: InfoPanelSectionCollapseState = {}
    for (const [key, value] of Object.entries(state)) {
      if (value === true) collapsedOnly[key] = true
    }

    if (Object.keys(collapsedOnly).length === 0) {
      storage.removeItem(storageKey)
      return
    }
    storage.setItem(storageKey, JSON.stringify(collapsedOnly))
  } catch {
    // Persistence is best effort and must not block the info panel.
  }
}

const { subscribe, set, update } = writable<InfoPanelSectionCollapseState>(readPersisted())

export const infoPanelSectionCollapse = { subscribe }

export function isInfoPanelSectionCollapsed(state: InfoPanelSectionCollapseState, key: string): boolean {
  return state[key] === true
}

export function setInfoPanelSectionCollapsed(key: string, collapsed: boolean): void {
  update((current) => {
    const next = { ...current, [key]: collapsed }
    writePersisted(next)
    return next
  })
}

export function toggleInfoPanelSection(key: string): void {
  update((current) => {
    const next = { ...current, [key]: !isInfoPanelSectionCollapsed(current, key) }
    writePersisted(next)
    return next
  })
}

export function clearInfoPanelSectionCollapse(): void {
  writePersisted({})
  set({})
}
