import { describe, expect, it, vi } from 'vitest'
import type { ShortcutRegistry } from './shortcuts.svelte'
import { registerAppShortcuts } from './appShortcuts'
import {
  APP_SHORTCUT_DEFINITIONS,
  getGlobalShortcutHelpEntries,
  getPrimaryAppShortcutKey,
} from './appShortcutDefinitions'

function createRegistry() {
  const handlers = new Map<string, (event?: KeyboardEvent) => void>()
  const registry: ShortcutRegistry = {
    register: vi.fn((key: string, handler: (event?: KeyboardEvent) => void) => {
      handlers.set(key.toLowerCase(), handler)
    }),
    unregister: vi.fn(),
    handleKeydown: vi.fn(),
  }
  return { registry, handlers }
}

describe('registerAppShortcuts', () => {
  it('keeps registered shortcuts sourced from the shared app shortcut definitions', () => {
    const { registry, handlers } = createRegistry()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      navigateForward: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen: vi.fn(),
      canToggleFileQuickOpen: () => true,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode: vi.fn(),
    })

    const definitionKeys = APP_SHORTCUT_DEFINITIONS.flatMap((definition) =>
      definition.registrations.map((registration) => registration.key.toLowerCase())
    )

    expect([...handlers.keys()].sort()).toEqual([...definitionKeys].sort())
  })

  it('exposes help entries from the same shared definitions used for registration', () => {
    expect(getGlobalShortcutHelpEntries()).toEqual([
      { id: 'attention-overview', label: 'Attention overview', keys: [['⌘', 'E'], ['⌘', ';']] },
      { id: 'switch-project', label: 'Switch Project', keys: [['⌘', '⇧', 'P']] },
      { id: 'new-task', label: 'New Task', keys: [['⌘N']] },
      { id: 'go-back', label: 'Go Back', keys: [['⌘[']] },
      { id: 'refresh-github', label: 'Refresh GitHub', keys: [['⌘', '⇧', 'R']] },
      { id: 'voice-input', label: 'Voice input', keys: [['⌘D']] },
      { id: 'files', label: 'Files', keys: [['⌘P']] },
      { id: 'terminal', label: 'Terminal', keys: [['⌘J']] },
      { id: 'search-tasks', label: 'Search Tasks', keys: [['⌘', '⇧', 'F']] },
      { id: 'action-palette', label: 'Action palette', keys: [['⌘K']] },
      { id: 'show-shortcuts', label: 'Show shortcuts', keys: [['?']] },
    ])
  })

  it('registers global shell shortcuts with their actions', () => {
    const { registry, handlers } = createRegistry()
    const showShortcuts = vi.fn()
    const openActionPalette = vi.fn()
    const toggleProjectSwitcher = vi.fn()
    const toggleSidebar = vi.fn()
    const openNewTaskDialog = vi.fn()
    const goBack = vi.fn()
    const toggleVoiceRecording = vi.fn()
    const toggleCommandPalette = vi.fn()
    const toggleFileQuickOpen = vi.fn()
    const resetToBoard = vi.fn()
    const navigateToGlobalSettings = vi.fn()
    const cycleActiveProject = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts,
      openActionPalette,
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher,
      toggleSidebar,
      openNewTaskDialog,
      goBack,
      navigateForward: vi.fn(),
      toggleVoiceRecording,
      toggleCommandPalette,
      toggleFileQuickOpen,
      canToggleFileQuickOpen: () => true,
      resetToBoard,
      navigateToGlobalSettings,
      cycleActiveProject,
      toggleZenMode: vi.fn(),
    })

    handlers.get('?')?.()
    handlers.get('⌘k')?.()
    handlers.get('⌘⇧p')?.()
    handlers.get('⌘b')?.()
    handlers.get('⌘n')?.()
    handlers.get('⌘[')?.()
    handlers.get('⌘d')?.()
    handlers.get('⌘⇧f')?.()
    handlers.get('⌘p')?.()
    handlers.get('⌘h')?.()
    handlers.get('⌘,')?.()
    handlers.get('⌃n')?.()
    handlers.get('⌃p')?.()
    handlers.get('1')?.()
    handlers.get('2')?.()

    expect(showShortcuts).toHaveBeenCalledOnce()
    expect(openActionPalette).toHaveBeenCalledOnce()
    expect(toggleProjectSwitcher).toHaveBeenCalledOnce()
    expect(toggleSidebar).toHaveBeenCalledOnce()
    expect(openNewTaskDialog).toHaveBeenCalledOnce()
    expect(goBack).toHaveBeenCalledOnce()
    expect(toggleVoiceRecording).toHaveBeenCalledOnce()
    expect(toggleCommandPalette).toHaveBeenCalledOnce()
    expect(toggleFileQuickOpen).toHaveBeenCalledOnce()
    expect(resetToBoard).toHaveBeenCalledOnce()
    expect(navigateToGlobalSettings).toHaveBeenCalledOnce()
    expect(cycleActiveProject).toHaveBeenNthCalledWith(1, 'next', { boardOnly: true })
    expect(cycleActiveProject).toHaveBeenNthCalledWith(2, 'previous', { boardOnly: true })
    expect(cycleActiveProject).toHaveBeenNthCalledWith(3, 'previous')
    expect(cycleActiveProject).toHaveBeenNthCalledWith(4, 'next')
  })

  it('maps Ctrl+Tab to Back and Ctrl+Shift+Tab (plus symmetry aliases) to Forward', () => {
    const { registry, handlers } = createRegistry()
    const goBack = vi.fn()
    const navigateForward = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack,
      navigateForward,
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen: vi.fn(),
      canToggleFileQuickOpen: () => true,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode: vi.fn(),
    })

    handlers.get('⌃tab')?.()
    expect(goBack).toHaveBeenCalledOnce()

    handlers.get('⌃⇧tab')?.()
    handlers.get('⌘]')?.()
    handlers.get('⌘arrowright')?.()
    handlers.get('⌃]')?.()
    expect(navigateForward).toHaveBeenCalledTimes(4)
  })

  it('opens the attention overview from either the left-hand or right-hand chord', () => {
    const { registry, handlers } = createRegistry()
    const toggleAttentionOverview = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview,
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      navigateForward: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen: vi.fn(),
      canToggleFileQuickOpen: () => true,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode: vi.fn(),
    })

    handlers.get('⌘e')?.()
    handlers.get('⌘;')?.()

    expect(toggleAttentionOverview).toHaveBeenCalledTimes(2)
  })

  it('no longer registers the retired three-key attention overview chord', () => {
    const { registry, handlers } = createRegistry()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      navigateForward: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen: vi.fn(),
      canToggleFileQuickOpen: () => true,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode: vi.fn(),
    })

    expect(handlers.has('⌘⇧a')).toBe(false)
  })

  it('advertises the left-hand chord as the primary attention overview shortcut', () => {
    expect(getPrimaryAppShortcutKey('attention-overview')).toBe('⌘E')
  })

  it('routes every zen mode chord (⌘./⌃. and the left-hand ⌘G/⌃G) to the toggle', () => {
    const { registry, handlers } = createRegistry()
    const toggleZenMode = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      navigateForward: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen: vi.fn(),
      canToggleFileQuickOpen: () => true,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode,
    })

    handlers.get('⌘.')?.()
    handlers.get('⌃.')?.()
    handlers.get('⌘g')?.()
    handlers.get('⌃g')?.()

    expect(toggleZenMode).toHaveBeenCalledTimes(4)
  })

  it('does not toggle file quick open while modal state blocks it', () => {
    const { registry, handlers } = createRegistry()
    const toggleFileQuickOpen = vi.fn()

    registerAppShortcuts(registry, {
      showShortcuts: vi.fn(),
      openActionPalette: vi.fn(),
      toggleAttentionOverview: vi.fn(),
      toggleProjectSwitcher: vi.fn(),
      toggleSidebar: vi.fn(),
      openNewTaskDialog: vi.fn(),
      goBack: vi.fn(),
      navigateForward: vi.fn(),
      toggleVoiceRecording: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleFileQuickOpen,
      canToggleFileQuickOpen: () => false,
      resetToBoard: vi.fn(),
      navigateToGlobalSettings: vi.fn(),
      cycleActiveProject: vi.fn(),
      toggleZenMode: vi.fn(),
    })

    handlers.get('⌘p')?.()

    expect(toggleFileQuickOpen).not.toHaveBeenCalled()
  })
})
