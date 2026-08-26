import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invoke(...args),
  isElectronDesktopBridgeAvailable: () => true,
}))

import { createProjectFromGit } from './ipc/tasks'

describe('createProjectFromGit', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes create_project_from_git with a camelCase payload', async () => {
    invoke.mockResolvedValue({ id: 'P-1', name: 'Widgets', path: '/tmp/widgets', created_at: 1, updated_at: 1 })
    const project = await createProjectFromGit({
      url: 'https://github.com/acme/widgets',
      parentDir: '/tmp',
      name: 'Widgets',
    })
    expect(invoke).toHaveBeenCalledWith('create_project_from_git', {
      url: 'https://github.com/acme/widgets',
      parentDir: '/tmp',
      name: 'Widgets',
    })
    expect(project.id).toBe('P-1')
  })
})
