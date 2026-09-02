import { APP_SHORTCUT_DEFINITIONS } from './appShortcutDefinitions'
import type { AppShortcutAction } from './appShortcutDefinitions'
import type { ShortcutRegistry } from './shortcuts.svelte'

export interface AppShortcutHandlers {
  showShortcuts(): void
  openActionPalette(): void | Promise<void>
  toggleAttentionOverview(): void
  toggleProjectSwitcher(): void
  toggleSidebar(): void
  openNewTaskDialog(): void
  goBack(): void
  navigateForward(): void
  toggleVoiceRecording(): void
  toggleCommandPalette(): void
  toggleFileQuickOpen(): void
  canToggleFileQuickOpen(): boolean
  resetToBoard(): void
  navigateToGlobalSettings(): void
  cycleActiveProject(direction: 'previous' | 'next', options?: { boardOnly?: boolean }): void
  toggleZenMode(): void
}

function runAppShortcutAction(action: AppShortcutAction, handlers: AppShortcutHandlers): void {
  switch (action) {
    case 'showShortcuts':
      handlers.showShortcuts()
      break
    case 'openActionPalette':
      void handlers.openActionPalette()
      break
    case 'toggleAttentionOverview':
      handlers.toggleAttentionOverview()
      break
    case 'toggleProjectSwitcher':
      handlers.toggleProjectSwitcher()
      break
    case 'toggleSidebar':
      handlers.toggleSidebar()
      break
    case 'openNewTaskDialog':
      handlers.openNewTaskDialog()
      break
    case 'goBack':
      handlers.goBack()
      break
    case 'goForward':
      handlers.navigateForward()
      break
    case 'toggleVoiceRecording':
      handlers.toggleVoiceRecording()
      break
    case 'toggleCommandPalette':
      handlers.toggleCommandPalette()
      break
    case 'toggleFileQuickOpen':
      if (handlers.canToggleFileQuickOpen()) {
        handlers.toggleFileQuickOpen()
      }
      break
    case 'resetToBoard':
      handlers.resetToBoard()
      break
    case 'navigateToGlobalSettings':
      handlers.navigateToGlobalSettings()
      break
    case 'cycleNextProjectOnBoard':
      handlers.cycleActiveProject('next', { boardOnly: true })
      break
    case 'cyclePreviousProjectOnBoard':
      handlers.cycleActiveProject('previous', { boardOnly: true })
      break
    case 'cyclePreviousProject':
      handlers.cycleActiveProject('previous')
      break
    case 'cycleNextProject':
      handlers.cycleActiveProject('next')
      break
    case 'toggleZenMode':
      handlers.toggleZenMode()
      break
  }
}

export function registerAppShortcuts(shortcuts: ShortcutRegistry, handlers: AppShortcutHandlers): void {
  for (const definition of APP_SHORTCUT_DEFINITIONS) {
    for (const registration of definition.registrations) {
      shortcuts.register(registration.key, () => {
        runAppShortcutAction(registration.action, handlers)
      })
    }
  }
}
