import { cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  mockExecutePluginCommand,
  persistInstalledPluginRow,
  resetPluginRuntimeFixtures,
} from './App.test-fixtures/plugin-runtime'
import { resetIpcFixtures } from './App.test-fixtures/ipc'
import { resetStoreFixtures } from './App.test-fixtures/stores'
import { resetDesktopLifecycleFixtures } from './App.test-fixtures/desktop-lifecycle'
import './App.test-fixtures/routing'

vi.mock('./components/focus-board/FocusBoard.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/task-detail/TaskDetailView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/AddTaskDialog.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/settings/SettingsView.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/prompt/PromptInput.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shared/ui/SearchableSelect.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/feedback/toasts/ToastHost.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/AppSidebar.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/project/ProjectSwitcherModal.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/project/ProjectSetupDialog.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/IconRail.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/CommandPalette.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/ActionPalette.svelte', () => ({ default: vi.fn() }))
vi.mock('./components/shell/FileQuickOpen.svelte', () => ({ default: vi.fn() }))

vi.mock('./lib/doingStatus', () => ({
  computeDoingStatus: vi.fn(() => 'idle'),
}))

vi.mock('./lib/terminalPool', () => ({
  acquire: vi.fn(async () => ({ ptyActive: false })),
  attach: vi.fn(),
  detach: vi.fn(),
  focusTerminal: vi.fn(),
  isPtyActive: vi.fn(() => false),
  release: vi.fn(),
}))

vi.mock('@lucide/svelte', () => {
  const stub = vi.fn()
  return {
    RefreshCw: stub,
    ChevronLeft: stub,
    ChevronRight: stub,
    Settings: stub,
    Plus: stub,
    FolderOpen: stub,
    LayoutDashboard: stub,
    GitPullRequest: stub,
    Sparkles: stub,
    PanelRight: stub,
  }
})

export function installAppTestLifecycle() {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetIpcFixtures()
    resetStoreFixtures()
    resetDesktopLifecycleFixtures()
    await resetPluginRuntimeFixtures()

    const { forceGithubSync, registerBuiltinPlugin } = await import('./lib/ipc')
    vi.mocked(registerBuiltinPlugin).mockImplementation(async (plugin) => {
      persistInstalledPluginRow(plugin)
    })
    mockExecutePluginCommand.mockImplementation(async (pluginId, commandId) => {
      if (pluginId === 'com.openforge.github-sync' && commandId === 'refresh') {
        await forceGithubSync()
      }
      return true
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })
}
