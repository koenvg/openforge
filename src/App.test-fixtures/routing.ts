import { get } from 'svelte/store'
import { vi } from 'vitest'
import {
  mockActiveProjectIdStore,
  mockCurrentViewStore,
  mockSelectedReviewPrStore,
  mockSelectedTaskIdStore,
} from './stores'

export const mockRouterPushNavState = vi.fn()
export const mockRouterBack = vi.fn(() => false)
export const mockRouterForward = vi.fn(() => false)
export const mockRouterNavigateToTask = vi.fn((taskId: string) => {
  mockSelectedTaskIdStore.set(taskId)
})
export const mockRouterResetToBoard = vi.fn(() => {
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockSelectedReviewPrStore.set(null)
})
export const mockRouterRestoreProjectView = vi.fn((_projectId: string) => {
  // Mirror the real fallback for a project with no snapshot: land on the board with
  // nothing open, and report no remembered task so switchToProject skips the reload.
  mockCurrentViewStore.set('board')
  mockSelectedTaskIdStore.set(null)
  mockSelectedReviewPrStore.set(null)
  return null
})
export const mockRouterNavigate = vi.fn((view: string) => {
  if (view === 'board') {
    if (get(mockCurrentViewStore) === 'board') {
      mockSelectFocusBoardTab(get(mockActiveProjectIdStore))
    }
    mockRouterResetToBoard()
    return
  }
  mockCurrentViewStore.set(view as any)
  if (new Set(['settings', 'global_settings']).has(view) || view.startsWith('plugin:')) {
    mockSelectedTaskIdStore.set(null)
  }
})
export const mockSelectFocusBoardTab = vi.fn((_projectId: string | null) => {})

vi.mock('../lib/router.svelte', () => ({
  pushNavState: mockRouterPushNavState,
  resetToBoard: mockRouterResetToBoard,
  restoreProjectView: mockRouterRestoreProjectView,
  selectFocusBoardTab: mockSelectFocusBoardTab,
  useAppRouter: () => ({
    navigate: mockRouterNavigate,
    navigateToTask: mockRouterNavigateToTask,
    back: mockRouterBack,
    forward: mockRouterForward,
    resetToBoard: mockRouterResetToBoard,
    get currentView() {
      return get(mockCurrentViewStore)
    },
  }),
}))
