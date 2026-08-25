import { vi } from 'vitest'

export type MockCloseRequestEvent = {
  preventDefault: () => void
}

export let closeRequestedHandler:
  | ((event: MockCloseRequestEvent) => void | Promise<void>)
  | null = null

export const mockWindowOnCloseRequested = vi.fn(
  async (callback: (event: MockCloseRequestEvent) => void | Promise<void>) => {
    closeRequestedHandler = callback
    return () => {
      closeRequestedHandler = null
    }
  },
)
export const mockWindowDestroy = vi.fn(async () => undefined)

vi.mock('../lib/desktopWindow', () => ({
  createDesktopWindow: vi.fn(() => ({
    onCloseRequested: mockWindowOnCloseRequested,
    destroy: mockWindowDestroy,
  })),
}))

export function resetDesktopLifecycleFixtures() {
  closeRequestedHandler = null
}
