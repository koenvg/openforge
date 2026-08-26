import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invoke(...args),
  isElectronDesktopBridgeAvailable: () => true,
}))

import { createProjectFromNewRepo } from './ipc/tasks'

describe('createProjectFromNewRepo', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes create_project_from_new_repo with a camelCase payload', async () => {
    invoke.mockResolvedValue({ id: 'P-1', name: 'My Idea', path: '/repos/my-idea', created_at: 1, updated_at: 1 })
    const project = await createProjectFromNewRepo({ name: 'My Idea', parentDir: '/repos', private: true })
    expect(invoke).toHaveBeenCalledWith('create_project_from_new_repo', {
      name: 'My Idea',
      parentDir: '/repos',
      private: true,
    })
    expect(project.id).toBe('P-1')
  })
})
