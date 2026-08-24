import { describe, expect, it } from 'vitest'
import { isSidecarBackedCommand } from './backendBridge'
import { desktopCommandContracts } from '../lib/desktopIpcContract'

describe('Electron backend bridge routing contracts', () => {
  it('routes every Rust-owned desktop command to the sidecar', () => {
    const missing = desktopCommandContracts
      .filter(contract => contract.owner === 'rust-sidecar')
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
    expect(isSidecarBackedCommand('fs_write_file')).toBe(true)
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
