import { writable } from 'svelte/store'
import type { AppView } from './types'

// Session-only flag. Zen mode strips the app chrome down to just the agent
// terminal. It resets on restart by design — it is never persisted.
export const zenMode = writable(false)

export interface ZenActiveInput {
  zenMode: boolean
  currentView: AppView
  selectedTaskId: string | null
  activeView: string
}

// Zen only takes visual effect while the agent terminal is the thing on screen:
// the flag is on, a task is open on the board, and its agent tab is active.
// Switching to any other tab drops the effect without clearing the flag.
export function isZenActive({ zenMode, currentView, selectedTaskId, activeView }: ZenActiveInput): boolean {
  return zenMode && currentView === 'board' && selectedTaskId !== null && activeView === 'agent'
}

export interface ZenToggleInput {
  currentView: AppView
  selectedTaskId: string | null
}

// The shortcut only means something while viewing a task, so it is a no-op on
// the board or in settings.
export function canToggleZenMode({ currentView, selectedTaskId }: ZenToggleInput): boolean {
  return currentView === 'board' && selectedTaskId !== null
}
