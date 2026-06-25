import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPluginRuntimeHost, invokePluginHostCommand } from './pluginHostCommands'

function installDesktopBridge(result: unknown = []): { invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn().mockResolvedValue(result)
  window.openforge = {
    version: 1,
    invoke,
    onEvent: vi.fn(() => vi.fn()),
  }
  return { invoke }
}

describe('plugin host commands', () => {
  beforeEach(() => {
    delete window.openforge
  })

  it('routes plugin task creation and implementation starts through the approved host contract', async () => {
    const { invoke } = installDesktopBridge()
    const task = {
      id: 'T-2',
      initial_prompt: 'Scheduled work',
      status: 'backlog',
      prompt: null,
      summary: null,
      agent: null,
      permission_mode: null,
      worktree_source: null,
      worktree_branch: null,
      depends_on: ['T-1'],
      project_id: 'P-1',
      created_at: 1,
      updated_at: 1,
    }
    invoke.mockResolvedValueOnce(task)

    await invokePluginHostCommand('createTask', {
      initialPrompt: 'Scheduled work',
      status: 'done',
      projectId: 'P-1',
      permissionMode: 'default',
      dependsOn: ['T-1'],
      labelNames: ['scheduler'],
      agent: 'worker',
    })
    expect(invoke).toHaveBeenLastCalledWith('create_task', {
      initialPrompt: 'Scheduled work',
      status: 'backlog',
      projectId: 'P-1',
      permissionMode: null,
      dependsOn: ['T-1'],
      labelNames: ['scheduler'],
      worktreeSource: null,
      worktreeBranch: null,
    })

    invoke.mockResolvedValueOnce(task)
    invoke.mockResolvedValueOnce([{ id: 'P-1', name: 'OpenForge', path: '/repo', created_at: 1, updated_at: 1 }])
    invoke.mockResolvedValueOnce({ task_id: 'T-2', workspace_path: '/repo/.worktrees/T-2', session_id: 'S-1', port: 0 })
    await expect(invokePluginHostCommand('startImplementation', {
      taskId: 'T-2',
      repoPath: '/ignored',
      provider: 'pi',
      agent: 'worker',
      permissionMode: 'default',
    })).resolves.toEqual({ taskId: 'T-2', workspacePath: '/repo/.worktrees/T-2', sessionId: 'S-1' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_task_detail', { taskId: 'T-2' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_projects', null)
    expect(invoke).toHaveBeenNthCalledWith(4, 'start_implementation', {
      taskId: 'T-2',
      repoPath: '/repo',
    })
  })

  it('routes runtime host shell callbacks through concrete PTY session keys', async () => {
    const { invoke } = installDesktopBridge('buffered')
    const host = createPluginRuntimeHost('test-plugin')

    await host.writeShell({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(invoke).toHaveBeenLastCalledWith('pty_write', { taskId: 'T-1-shell-2', data: 'echo hi\n' })

    await host.resizeShell({ taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(invoke).toHaveBeenLastCalledWith('pty_resize', { taskId: 'T-1-shell-2', cols: 120, rows: 40 })

    await host.killShell({ taskId: 'T-1', terminalIndex: 2 })
    expect(invoke).toHaveBeenLastCalledWith('pty_kill', { taskId: 'T-1-shell-2' })

    await expect(host.getShellBuffer({ taskId: 'T-1', terminalIndex: 2 })).resolves.toBe('buffered')
    expect(invoke).toHaveBeenLastCalledWith('get_pty_buffer', { taskId: 'T-1-shell-2' })
  })

  it('routes indexed shell host commands through concrete PTY session keys', async () => {
    const { invoke } = installDesktopBridge('buffered')

    await expect(invokePluginHostCommand('spawnShellPty', {
      taskId: 'T-1',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
    })).resolves.toBe('buffered')
    expect(invoke).toHaveBeenLastCalledWith('pty_spawn_shell', {
      taskId: 'T-1',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
    })

    await invokePluginHostCommand('writePty', { taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(invoke).toHaveBeenLastCalledWith('pty_write', { taskId: 'T-1-shell-2', data: 'echo hi\n' })

    await invokePluginHostCommand('resizePty', { taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(invoke).toHaveBeenLastCalledWith('pty_resize', { taskId: 'T-1-shell-2', cols: 120, rows: 40 })

    await invokePluginHostCommand('killPty', { taskId: 'T-1', terminalIndex: 2 })
    expect(invoke).toHaveBeenLastCalledWith('pty_kill', { taskId: 'T-1-shell-2' })

    await expect(invokePluginHostCommand('getPtyBuffer', { taskId: 'T-1', terminalIndex: 2 })).resolves.toBe('buffered')
    expect(invoke).toHaveBeenLastCalledWith('get_pty_buffer', { taskId: 'T-1-shell-2' })
  })

  it('rejects missing indexed shell host command payloads instead of coercing them to shell zero', async () => {
    const { invoke } = installDesktopBridge('buffered')

    for (const terminalIndex of [null, '']) {
      await expect(invokePluginHostCommand('writePty', { taskId: 'T-1', terminalIndex, data: 'echo hi\n' })).rejects.toThrow('terminalIndex')
      await expect(invokePluginHostCommand('resizePty', { taskId: 'T-1', terminalIndex, cols: 120, rows: 40 })).rejects.toThrow('terminalIndex')
      await expect(invokePluginHostCommand('killPty', { taskId: 'T-1', terminalIndex })).rejects.toThrow('terminalIndex')
      await expect(invokePluginHostCommand('getPtyBuffer', { taskId: 'T-1', terminalIndex })).rejects.toThrow('terminalIndex')
    }

    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not expose GitHub Sync PR review operations as core plugin host commands', async () => {
    const { invoke } = installDesktopBridge([])

    for (const command of [
      'forceGithubSync',
      'fetchReviewPrs',
      'getReviewPrs',
      'getPrFileDiffs',
      'getReviewComments',
      'submitPrReview',
      'getAgentReviewComments',
      'updateAgentReviewCommentStatus',
    ]) {
      await expect(invokePluginHostCommand(command, {})).rejects.toThrow(`Unknown plugin host command: ${command}`)
    }

    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not expose removed live agent review, resume implementation, or skills-viewer host commands', async () => {
    const { invoke } = installDesktopBridge()

    await expect(invokePluginHostCommand('startAgentReview', { reviewPrId: 42 })).rejects.toThrow('Unknown plugin host command: startAgentReview')
    await expect(invokePluginHostCommand('abortAgentReview', { reviewSessionKey: 'review-42' })).rejects.toThrow('Unknown plugin host command: abortAgentReview')
    await expect(invokePluginHostCommand('resumeImplementation', { taskId: 'T-2' })).rejects.toThrow('Unknown plugin host command: resumeImplementation')
    await expect(invokePluginHostCommand('listOpenCodeSkills', { projectId: 'P-1' })).rejects.toThrow('Unknown plugin host command: listOpenCodeSkills')
    await expect(invokePluginHostCommand('saveSkillContent', { projectId: 'P-1' })).rejects.toThrow('Unknown plugin host command: saveSkillContent')
    expect(invoke).not.toHaveBeenCalled()
  })
})
