import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { spawnShellPty } from './ipc'

describe('ipc spawnShellPty', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(7)
  })

  it('sends terminalIndex in the invoke payload for shell tabs', async () => {
    await spawnShellPty('T-42', '/tmp/worktree', 80, 24, 1)

    expect(invokeMock).toHaveBeenCalledWith('pty_spawn_shell', {
      taskId: 'T-42',
      cwd: '/tmp/worktree',
      cols: 80,
      rows: 24,
      terminalIndex: 1,
    })
  })
})
