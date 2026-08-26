import { vi } from 'vitest'

const { mockResetToBoard } = vi.hoisted(() => ({
  mockResetToBoard: vi.fn(),
}))

vi.mock('../../lib/router.svelte', () => ({
  resetToBoard: mockResetToBoard,
  pushNavState: vi.fn(),
  useAppRouter: () => ({
    resetToBoard: mockResetToBoard,
  }),
}))

export { mockResetToBoard }
