import { describe, expect, it, vi } from 'vitest'
import { handleElectronInvoke } from './backendBridge'
import { sidecarConfig } from './backendBridge.testUtils'

describe('Electron backend bridge repository-access recovery', () => {
  it('prompts for repository folder access and retries start_implementation after a Documents permission failure', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Cannot access repository path \'/Users/koen/Documents/openforge test project\': Operation not permitted',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { task_id: 'KVG-1272', workspace_path: '/tmp/worktree', session_id: 's-1', port: 0 } }),
      })
    const selectDirectory = vi.fn(async () => '/Users/koen/Documents/openforge test project')

    await expect(handleElectronInvoke(
      { command: 'start_implementation', payload: { taskId: 'KVG-1272', repoPath: '/Users/koen/Documents/openforge test project' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), selectDirectory },
    )).resolves.toEqual({ task_id: 'KVG-1272', workspace_path: '/tmp/worktree', session_id: 's-1', port: 0 })

    expect(selectDirectory).toHaveBeenCalledWith({
      defaultPath: '/Users/koen/Documents/openforge test project',
      buttonLabel: 'Grant Access',
      message: 'OpenForge needs permission to access this repository folder before it can create a worktree.',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not start a task against a different folder selected during repository access recovery', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Cannot access repository path \'/Users/koen/Documents/openforge test project\': Operation not permitted',
      json: async () => ({}),
    })
    const selectDirectory = vi.fn(async () => '/Users/koen/Documents/other project')

    await expect(handleElectronInvoke(
      { command: 'start_implementation', payload: { taskId: 'KVG-1272', repoPath: '/Users/koen/Documents/openforge test project' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), selectDirectory },
    )).rejects.toThrow('Selected repository folder does not match')

    expect(fetch).toHaveBeenCalledTimes(1)
  })

})
