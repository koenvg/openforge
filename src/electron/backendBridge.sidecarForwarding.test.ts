import { describe, expect, it, vi } from 'vitest'
import { handleElectronInvoke } from './backendBridge'
import { sidecarConfig } from './backendBridge.testUtils'

describe('Electron backend bridge Rust sidecar forwarding', () => {
  it('forwards config/projects/tasks commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'P-1', name: 'Open Forge' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_projects', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 'P-1', name: 'Open Forge' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_projects', payload: null }),
    })
  })

  it('forwards PTY/session commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: 42 }),
    }))

    await expect(handleElectronInvoke(
      {
        command: 'pty_spawn_shell',
        payload: {
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 2,
        },
      },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toBe(42)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'pty_spawn_shell',
        payload: {
          taskId: 'T-1',
          cwd: '/tmp/worktree',
          cols: 80,
          rows: 24,
          terminalIndex: 2,
        },
      }),
    })
  })

  it('forwards force_github_sync to the authenticated sidecar so it can use live GitHub client state', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        value: {
          new_comments: 1,
          ci_changes: 2,
          review_changes: 3,
          pr_changes: 4,
          errors: 0,
          rate_limited: false,
          rate_limit_reset_at: null,
        },
      }),
    }))

    await expect(handleElectronInvoke(
      { command: 'force_github_sync', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual({
      new_comments: 1,
      ci_changes: 2,
      review_changes: 3,
      pr_changes: 4,
      errors: 0,
      rate_limited: false,
      rate_limit_reset_at: null,
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'force_github_sync', payload: null }),
    })
  })

  it('forwards GitHub and PR review commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 10, title: 'Review me' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_review_prs', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 10, title: 'Review me' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_review_prs', payload: null }),
    })
  })

  it('forwards files-review commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ filename: 'src/main.ts' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_task_diff', payload: { taskId: 'T-1', includeCommitted: true, includeUncommitted: true } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ filename: 'src/main.ts' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_task_diff', payload: { taskId: 'T-1', includeCommitted: true, includeUncommitted: true } }),
    })
  })

  it('forwards plugin commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'com.example.plugin', name: 'Example' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'list_plugins', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 'com.example.plugin', name: 'Example' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'list_plugins', payload: null }),
    })
  })

  it('forwards compact Whisper audio payloads to the authenticated Rust sidecar route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: { text: 'hello', duration_ms: 12 } }),
    }))

    await expect(handleElectronInvoke(
      { command: 'transcribe_audio', payload: { audioPcmBase64: 'AAAAAAAAgD4AAIC+' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual({ text: 'hello', duration_ms: 12 })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'transcribe_audio', payload: { audioPcmBase64: 'AAAAAAAAgD4AAIC+' } }),
    })
  })

})
