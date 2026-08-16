import { describe, expect, it, vi } from 'vitest'
import { handleElectronInvoke, isSidecarBackedCommand } from './backendBridge'
import { ipcCommandContracts } from '../lib/electronMigrationContracts'
import type { SidecarLaunchConfig } from './sidecar'

function sidecarConfig(): SidecarLaunchConfig {
  return {
    command: 'openforge-sidecar',
    args: [],
    env: {},
    host: '127.0.0.1',
    port: 17642,
    token: 'launch-token',
    baseUrl: 'http://127.0.0.1:17642',
    healthUrl: 'http://127.0.0.1:17642/app/health',
    readinessUrl: 'http://127.0.0.1:17642/app/readiness',
    eventUrl: 'http://127.0.0.1:17642/app/events',
  }
}

describe('Electron backend bridge command forwarding', () => {
  it('keeps open_url shell-owned and does not forward it to the Rust sidecar', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'open_url', payload: { url: 'https://github.com' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal },
    )).resolves.toBeNull()

    expect(openExternal).toHaveBeenCalledWith('https://github.com')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps open_in_editor shell-owned and opens VS Code at the path', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'open_in_editor', payload: { path: '/Users/me/proj' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal },
    )).resolves.toBeNull()

    expect(openExternal).toHaveBeenCalledWith('vscode://file/Users/me/proj')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps quit_app shell-owned so Electron before-quit shutdown cleanup runs', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const quitApp = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'quit_app', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, quitApp },
    )).resolves.toBeUndefined()

    expect(quitApp).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps clipboard writes shell-owned and does not forward them to the Rust sidecar', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const writeClipboardText = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'write_clipboard_text', payload: { text: '/repo/T-42' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, writeClipboardText },
    )).resolves.toBeUndefined()

    expect(writeClipboardText).toHaveBeenCalledWith('/repo/T-42')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps developer log snapshots shell-owned and returns the file-backed tail', async () => {
    const fetch = vi.fn()
    const getDeveloperLogSnapshot = vi.fn(() => ({
      entries: [{
        id: 1,
        timestamp: '2026-07-03T12:00:00.000Z',
        level: 'info' as const,
        message: '[electron] ready',
      }],
      logFilePath: '/tmp/openforge.log',
      totalEntries: 1,
    }))

    await expect(handleElectronInvoke(
      { command: 'get_developer_log_snapshot', payload: { limit: 1000 } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), getDeveloperLogSnapshot },
    )).resolves.toEqual({
      entries: [expect.objectContaining({ message: '[electron] ready' })],
      logFilePath: '/tmp/openforge.log',
      totalEntries: 1,
    })

    expect(getDeveloperLogSnapshot).toHaveBeenCalledWith(1000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps developer logs shell-owned and passes through an explicit log limit', async () => {
    const fetch = vi.fn()
    const getDeveloperLogs = vi.fn(() => [{
      id: 1,
      timestamp: '2026-07-03T12:00:00.000Z',
      level: 'info' as const,
      message: '[electron] ready',
    }])

    await expect(handleElectronInvoke(
      { command: 'get_developer_logs', payload: { limit: 1 } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), getDeveloperLogs },
    )).resolves.toEqual([
      expect.objectContaining({ message: '[electron] ready' }),
    ])

    expect(getDeveloperLogs).toHaveBeenCalledWith(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps select_directory shell-owned so macOS folder access is granted through Electron', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const selectDirectory = vi.fn(async () => '/Users/koen/Documents/openforge test project')

    await expect(handleElectronInvoke(
      { command: 'select_directory', payload: { defaultPath: '/Users/koen/Documents/openforge test project' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, selectDirectory },
    )).resolves.toBe('/Users/koen/Documents/openforge test project')

    expect(selectDirectory).toHaveBeenCalledWith({
      defaultPath: '/Users/koen/Documents/openforge test project',
      buttonLabel: undefined,
      message: undefined,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

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

  it('forwards files/self-review/agent-review commands to the authenticated sidecar app IPC route', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 1, body: 'Fix this' }] }),
    }))

    await expect(handleElectronInvoke(
      { command: 'get_active_self_review_comments', payload: { taskId: 'T-1' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn() },
    )).resolves.toEqual([{ id: 1, body: 'Fix this' }])

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer launch-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'get_active_self_review_comments', payload: { taskId: 'T-1' } }),
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

  it('declares every Rust-owned renderer IPC command as sidecar-backed after the Electron cutover', () => {
    const missing = ipcCommandContracts
      .filter(contract => contract.targetOwner === 'rust-sidecar')
      .map(contract => contract.ipcCommand)
      .filter(command => !isSidecarBackedCommand(command))

    expect(missing).toEqual([])
  })

  it('declares config/projects/tasks, PTY/session, GitHub/PR review, and Whisper commands as sidecar-backed for this slice', () => {
    expect(isSidecarBackedCommand('get_projects')).toBe(true)
    expect(isSidecarBackedCommand('get_project_attention')).toBe(true)
    expect(isSidecarBackedCommand('get_task_attention')).toBe(true)
    expect(isSidecarBackedCommand('create_task')).toBe(true)
    expect(isSidecarBackedCommand('update_task_status')).toBe(true)
    expect(isSidecarBackedCommand('delete_task')).toBe(true)
    expect(isSidecarBackedCommand('list_browser_session_purge_intents')).toBe(true)
    expect(isSidecarBackedCommand('acknowledge_browser_session_purge_intent')).toBe(true)
    expect(isSidecarBackedCommand('delete_project')).toBe(true)
    expect(isSidecarBackedCommand('get_config')).toBe(true)
    for (const command of [
      'get_companion_gateway_status',
      'set_companion_gateway_enabled',
      'set_companion_tailscale_hostname',
      'start_companion_pairing',
      'get_companion_pairing_status',
      'cancel_companion_pairing',
      'approve_companion_pairing',
      'reject_companion_pairing',
      'list_companion_devices',
      'revoke_companion_device',
      'remove_companion_device',
      'reset_companion_host_identity',
    ]) {
      expect(isSidecarBackedCommand(command)).toBe(true)
    }
    expect(isSidecarBackedCommand('resolve_ai_provider')).toBe(true)
    expect(isSidecarBackedCommand('get_app_mode')).toBe(true)
    expect(isSidecarBackedCommand('get_git_branch')).toBe(true)
    expect(isSidecarBackedCommand('get_latest_session')).toBe(true)
    expect(isSidecarBackedCommand('get_latest_sessions')).toBe(true)
    expect(isSidecarBackedCommand('get_session_status')).toBe(true)
    expect(isSidecarBackedCommand('abort_session')).toBe(true)
    expect(isSidecarBackedCommand('resume_startup_sessions')).toBe(true)
    expect(isSidecarBackedCommand('start_implementation')).toBe(true)
    expect(isSidecarBackedCommand('finalize_agent_session')).toBe(true)
    expect(isSidecarBackedCommand('send_agent_follow_up')).toBe(true)
    expect(isSidecarBackedCommand('finalize_claude_session')).toBe(false)
    expect(isSidecarBackedCommand('get_task_workspace')).toBe(true)
    expect(isSidecarBackedCommand('pty_spawn_shell')).toBe(true)
    expect(isSidecarBackedCommand('pty_write')).toBe(true)
    expect(isSidecarBackedCommand('pty_resize')).toBe(true)
    expect(isSidecarBackedCommand('pty_kill')).toBe(true)
    expect(isSidecarBackedCommand('pty_kill_shells_for_task')).toBe(true)
    expect(isSidecarBackedCommand('get_pty_buffer')).toBe(true)
    expect(isSidecarBackedCommand('force_github_sync')).toBe(true)
    expect(isSidecarBackedCommand('refresh_task_github_status')).toBe(true)
    expect(isSidecarBackedCommand('get_pull_requests')).toBe(true)
    expect(isSidecarBackedCommand('get_pr_comments')).toBe(true)
    expect(isSidecarBackedCommand('mark_comment_addressed')).toBe(true)
    expect(isSidecarBackedCommand('merge_pull_request')).toBe(false)
    expect(isSidecarBackedCommand('enqueue_pull_request')).toBe(false)
    expect(isSidecarBackedCommand('merge_task_pull_request')).toBe(true)
    expect(isSidecarBackedCommand('enqueue_task_pull_request')).toBe(true)
    expect(isSidecarBackedCommand('fetch_review_prs')).toBe(true)
    expect(isSidecarBackedCommand('get_review_prs')).toBe(true)
    expect(isSidecarBackedCommand('mark_review_pr_viewed')).toBe(true)
    expect(isSidecarBackedCommand('mark_review_pr_unviewed')).toBe(true)
    expect(isSidecarBackedCommand('fetch_authored_prs')).toBe(true)
    expect(isSidecarBackedCommand('get_authored_prs')).toBe(true)
    expect(isSidecarBackedCommand('fs_read_dir')).toBe(true)
    expect(isSidecarBackedCommand('fs_read_file')).toBe(true)
    expect(isSidecarBackedCommand('fs_search_files')).toBe(true)
    expect(isSidecarBackedCommand('get_task_diff')).toBe(true)
    expect(isSidecarBackedCommand('get_task_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('get_task_batch_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('add_self_review_comment')).toBe(true)
    expect(isSidecarBackedCommand('get_active_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('get_archived_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('delete_self_review_comment')).toBe(true)
    expect(isSidecarBackedCommand('archive_self_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('get_task_commits')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_diff')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('get_commit_batch_file_contents')).toBe(true)
    expect(isSidecarBackedCommand('start_agent_review')).toBe(false)
    expect(isSidecarBackedCommand('get_agent_review_comments')).toBe(true)
    expect(isSidecarBackedCommand('update_agent_review_comment_status')).toBe(true)
    expect(isSidecarBackedCommand('list_opencode_skills')).toBe(false)
    expect(isSidecarBackedCommand('save_skill_content')).toBe(false)
    expect(isSidecarBackedCommand('dismiss_all_agent_review_comments')).toBe(false)
    expect(isSidecarBackedCommand('abort_agent_review')).toBe(false)
    expect(isSidecarBackedCommand('register_builtin_plugin')).toBe(true)
    expect(isSidecarBackedCommand('scan_plugin_folder')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_local')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_npm')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_git')).toBe(true)
    expect(isSidecarBackedCommand('install_plugin_from_source')).toBe(true)
    expect(isSidecarBackedCommand('uninstall_plugin')).toBe(true)
    expect(isSidecarBackedCommand('get_plugin')).toBe(true)
    expect(isSidecarBackedCommand('list_plugins')).toBe(true)
    expect(isSidecarBackedCommand('set_plugin_enabled')).toBe(true)
    expect(isSidecarBackedCommand('get_enabled_plugins')).toBe(true)
    expect(isSidecarBackedCommand('get_plugin_storage')).toBe(true)
    expect(isSidecarBackedCommand('set_plugin_storage')).toBe(true)
    expect(isSidecarBackedCommand('delete_plugin_storage')).toBe(true)
    expect(isSidecarBackedCommand('plugin_invoke')).toBe(true)
    expect(isSidecarBackedCommand('plugin_backend_deactivate')).toBe(true)
    expect(isSidecarBackedCommand('plugin_backend_when_ready')).toBe(true)
    expect(isSidecarBackedCommand('stop_plugin_sidecar')).toBe(true)
    expect(isSidecarBackedCommand('transcribe_audio')).toBe(true)
    expect(isSidecarBackedCommand('get_whisper_model_status')).toBe(true)
    expect(isSidecarBackedCommand('download_whisper_model')).toBe(true)
    expect(isSidecarBackedCommand('get_all_whisper_model_statuses')).toBe(true)
    expect(isSidecarBackedCommand('set_whisper_model')).toBe(true)
  })
})
