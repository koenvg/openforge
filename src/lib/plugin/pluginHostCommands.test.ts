import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentView, selectedTaskId, taskActiveView } from '../stores'
import { createPluginHostCommandDispatcher } from './pluginHostCommandRegistry'
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
    currentView.set('board')
    selectedTaskId.set(null)
    taskActiveView.set(new Map())
  })

  it('rejects duplicate command ownership across capability modules', () => {
    const handler = vi.fn()

    expect(() => createPluginHostCommandDispatcher(
      [['duplicate', handler]],
      [['duplicate', handler]],
    )).toThrow('Duplicate plugin host command: duplicate')
  })

  it('navigates to a Task and foregrounds the requesting plugin’s local Task UI tab', async () => {
    currentView.set('settings')
    const host = createPluginRuntimeHost('com.openforge.task-browser')

    await expect(host.navigate?.({
      taskId: 'T-1',
      taskViewId: 'browser',
    })).resolves.toMatchObject({
      currentView: 'board',
      selectedTaskId: 'T-1',
    })

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('T-1')
    expect(get(taskActiveView).get('T-1')).toBe('com.openforge.task-browser:browser')
  })

  it('preserves an explicit app view when navigation also selects a Task without a Task UI tab', async () => {
    const host = createPluginRuntimeHost('test-plugin')

    await host.navigate?.({ viewId: 'settings', taskId: 'T-1' })

    expect(get(currentView)).toBe('settings')
    expect(get(selectedTaskId)).toBe('T-1')
  })

  it('validates Task UI navigation before mutating navigation state', async () => {
    const host = createPluginRuntimeHost('test-plugin')

    await expect(host.navigate?.({
      viewId: 'settings',
      taskId: 'T-1',
      taskViewId: '   ',
    })).rejects.toThrow(/taskViewId must be non-empty/)

    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBeNull()
    expect(get(taskActiveView)).toEqual(new Map())
  })

  it('routes plugin task creation and implementation starts through the approved host contract', async () => {
    const { invoke } = installDesktopBridge()
    const task = {
      id: 'T-2',
      initial_prompt: 'Scheduled work',
      status: 'backlog',
      prompt: null,
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
      title: null,
      sourceTicketUrl: null,
      codeCleanupEnabled: undefined,
      taskDisplayTitleUpdatesEnabled: undefined,
      aiProvider: null,
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
      divergenceResolution: null,
      terminalImageProtocol: null,
      promptPrefix: null,
    })
  })
  it('routes typed Task follow-ups through the Agent Session host lifecycle', async () => {
    const { invoke } = installDesktopBridge({
      taskId: 'T-2',
      sessionId: 'S-1',
      disposition: 'queued',
    })
    const host = createPluginRuntimeHost('com.openforge.task-browser')

    await expect(host.sendTaskFollowUp?.({
      taskId: 'T-2',
      message: '# Visual feedback',
    })).resolves.toEqual({ taskId: 'T-2', sessionId: 'S-1', disposition: 'queued' })
    expect(invoke).toHaveBeenCalledWith('send_agent_follow_up', {
      taskId: 'T-2',
      message: '# Visual feedback',
    })
  })

  it('preserves typed retryable Task follow-up failures', async () => {
    const { invoke } = installDesktopBridge()
    invoke
      .mockRejectedValueOnce(new Error('AGENT_FOLLOW_UP_NO_SESSION: Task T-2 has no Agent Session'))
      .mockRejectedValueOnce(new Error('AGENT_FOLLOW_UP_DELIVERY_FAILED: Agent PTY unavailable'))
    const host = createPluginRuntimeHost('com.openforge.task-browser')

    await expect(host.sendTaskFollowUp?.({ taskId: 'T-2', message: 'Retry me' }))
      .rejects.toMatchObject({ name: 'TaskFollowUpError', code: 'NO_SESSION' })
    await expect(host.sendTaskFollowUp?.({ taskId: 'T-2', message: 'Retry me' }))
      .rejects.toMatchObject({ name: 'TaskFollowUpError', code: 'DELIVERY_FAILED' })
  })
  it('routes generic start prompt contribution configuration through project config only', async () => {
    const { invoke } = installDesktopBridge(null)
    invoke.mockResolvedValueOnce(JSON.stringify([{ id: 'existing', enabled: true, content: 'Existing', order: 0 }]))

    await expect(invokePluginHostCommand('listStartPromptContributions', {
      projectId: 'P-1',
    })).resolves.toEqual([{ id: 'existing', enabled: true, content: 'Existing', order: 0 }])
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_project_config', {
      projectId: 'P-1',
      key: 'start_prompt_contributions',
    })

    invoke.mockResolvedValueOnce([{
      id: 'review-guidance',
      enabled: true,
      content: 'Review Task {{taskId}} before editing',
      order: 5,
    }])

    await expect(invokePluginHostCommand('configureStartPromptContribution', {
      projectId: 'P-1',
      id: 'review-guidance',
      enabled: true,
      content: 'Review Task {{taskId}} before editing',
      order: 5,
      provider: 'codex',
      agent: 'ignored',
      permissionMode: 'trusted',
    })).resolves.toEqual([{
      id: 'review-guidance',
      enabled: true,
      content: 'Review Task {{taskId}} before editing',
      order: 5,
    }])
    expect(invoke).toHaveBeenNthCalledWith(2, 'configure_start_prompt_contribution', {
      ownerPluginId: null,
      projectId: 'P-1',
      id: 'review-guidance',
      enabled: true,
      content: 'Review Task {{taskId}} before editing',
      order: 5,
    })
    expect(invoke).not.toHaveBeenCalledWith('start_implementation', expect.anything())
  })
  it('persists the requesting frontend plugin as the contribution owner', async () => {
    const { invoke } = installDesktopBridge(null)
    invoke.mockResolvedValueOnce([{
      ownerPluginId: 'com.example.workflow',
      id: 'review-guidance',
      enabled: true,
      content: 'Review before editing',
      order: 5,
    }])
    const host = createPluginRuntimeHost('com.example.workflow')

    await expect(host.configureStartPromptContribution?.({
      projectId: 'P-1',
      id: 'review-guidance',
      enabled: true,
      content: 'Review before editing',
      order: 5,
    })).resolves.toEqual([{
      ownerPluginId: 'com.example.workflow',
      id: 'review-guidance',
      enabled: true,
      content: 'Review before editing',
      order: 5,
    }])
    expect(invoke).toHaveBeenLastCalledWith('configure_start_prompt_contribution', {
      ownerPluginId: 'com.example.workflow',
      projectId: 'P-1',
      id: 'review-guidance',
      enabled: true,
      content: 'Review before editing',
      order: 5,
    })
  })

  it('preserves prompt contributions configured concurrently by frontend plugins', async () => {
    const { invoke } = installDesktopBridge()
    let contributions: Array<{ ownerPluginId: string; id: string; enabled: boolean; content: string; order: number }> = []
    invoke.mockImplementation(async (command, payload) => {
      if (command === 'get_project_config') return JSON.stringify(contributions)
      if (command !== 'configure_start_prompt_contribution') return null
      const request = payload as typeof contributions[number] & { projectId: string }
      contributions = [
        ...contributions.filter(entry => entry.id !== request.id || entry.ownerPluginId !== request.ownerPluginId),
        {
          ownerPluginId: request.ownerPluginId,
          id: request.id,
          enabled: request.enabled,
          content: request.content,
          order: request.order,
        },
      ]
      return contributions
    })
    const first = createPluginRuntimeHost('com.example.first')
    const second = createPluginRuntimeHost('com.example.second')

    await Promise.all([
      first.configureStartPromptContribution?.({
        projectId: 'P-1',
        id: 'workflow',
        content: 'First workflow',
        enabled: true,
      }),
      second.configureStartPromptContribution?.({
        projectId: 'P-1',
        id: 'workflow',
        content: 'Second workflow',
        enabled: true,
      }),
    ])

    await expect(first.listStartPromptContributions?.('P-1')).resolves.toEqual([
      { ownerPluginId: 'com.example.first', id: 'workflow', enabled: true, content: 'First workflow', order: 0 },
      { ownerPluginId: 'com.example.second', id: 'workflow', enabled: true, content: 'Second workflow', order: 0 },
    ])
    expect(invoke).toHaveBeenCalledWith('configure_start_prompt_contribution', expect.objectContaining({
      ownerPluginId: 'com.example.first',
      projectId: 'P-1',
    }))
    expect(invoke).toHaveBeenCalledWith('configure_start_prompt_contribution', expect.objectContaining({
      ownerPluginId: 'com.example.second',
      projectId: 'P-1',
    }))
  })

  it('rejects non-integer contribution order without changing a safe integer', async () => {
    const { invoke } = installDesktopBridge([])
    const host = createPluginRuntimeHost('com.example.workflow')

    await expect(host.configureStartPromptContribution?.({
      projectId: 'P-1',
      id: 'workflow',
      content: 'Workflow',
      enabled: true,
      order: 1.5,
    })).rejects.toThrow('safe integer')
    expect(invoke).not.toHaveBeenCalled()

    await host.configureStartPromptContribution?.({
      projectId: 'P-1',
      id: 'workflow',
      content: 'Workflow',
      enabled: true,
      order: Number.MAX_SAFE_INTEGER,
    })
    expect(invoke).toHaveBeenCalledWith('configure_start_prompt_contribution', expect.objectContaining({
      order: Number.MAX_SAFE_INTEGER,
    }))
  })

  it('routes runtime host shell callbacks through Shell Session Keys', async () => {
    const { invoke } = installDesktopBridge({ buffer: 'buffered', isLive: true, instanceId: 42 })
    const host = createPluginRuntimeHost('test-plugin')

    await host.writeShell({ taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(invoke).toHaveBeenLastCalledWith('pty_write', { shellSessionKey: 'T-1-shell-2', data: 'echo hi\n' })

    await host.resizeShell({ taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(invoke).toHaveBeenLastCalledWith('pty_resize', { shellSessionKey: 'T-1-shell-2', cols: 120, rows: 40 })

    await host.killShell({ taskId: 'T-1', terminalIndex: 2 })
    expect(invoke).toHaveBeenLastCalledWith('pty_kill', { shellSessionKey: 'T-1-shell-2' })

    await expect(host.getShellBuffer({ taskId: 'T-1', terminalIndex: 2 })).resolves.toEqual({ buffer: 'buffered', isLive: true, instanceId: 42 })
    expect(invoke).toHaveBeenLastCalledWith('get_pty_buffer', { shellSessionKey: 'T-1-shell-2' })
  })

  it('routes indexed shell host commands through Shell Session Keys', async () => {
    const { invoke } = installDesktopBridge('buffered')

    await expect(invokePluginHostCommand('spawnShellPty', {
      taskId: 'T-1',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
      terminalImageProtocol: 'iterm2',
    })).resolves.toBe('buffered')
    expect(invoke).toHaveBeenLastCalledWith('pty_spawn_shell', {
      taskId: 'T-1',
      cwd: '/repo',
      cols: 80,
      rows: 24,
      terminalIndex: 2,
      terminalImageProtocol: 'iterm2',
    })

    await invokePluginHostCommand('writePty', { taskId: 'T-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(invoke).toHaveBeenLastCalledWith('pty_write', { shellSessionKey: 'T-1-shell-2', data: 'echo hi\n' })

    await invokePluginHostCommand('resizePty', { taskId: 'T-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(invoke).toHaveBeenLastCalledWith('pty_resize', { shellSessionKey: 'T-1-shell-2', cols: 120, rows: 40 })

    await invokePluginHostCommand('killPty', { taskId: 'T-1', terminalIndex: 2 })
    expect(invoke).toHaveBeenLastCalledWith('pty_kill', { shellSessionKey: 'T-1-shell-2' })

    invoke.mockResolvedValue({ buffer: 'buffered', isLive: true, instanceId: 42 })
    await expect(invokePluginHostCommand('getPtyBuffer', { taskId: 'T-1', terminalIndex: 2 })).resolves.toEqual({ buffer: 'buffered', isLive: true, instanceId: 42 })
    expect(invoke).toHaveBeenLastCalledWith('get_pty_buffer', { shellSessionKey: 'T-1-shell-2' })
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

  it('does not expose removed live agent review, resume implementation, or legacy OpenCode skills host commands', async () => {
    const { invoke } = installDesktopBridge()

    await expect(invokePluginHostCommand('startAgentReview', { reviewPrId: 42 })).rejects.toThrow('Unknown plugin host command: startAgentReview')
    await expect(invokePluginHostCommand('abortAgentReview', { reviewSessionKey: 'review-42' })).rejects.toThrow('Unknown plugin host command: abortAgentReview')
    await expect(invokePluginHostCommand('resumeImplementation', { taskId: 'T-2' })).rejects.toThrow('Unknown plugin host command: resumeImplementation')
    await expect(invokePluginHostCommand('listOpenCodeSkills', { projectId: 'P-1' })).rejects.toThrow('Unknown plugin host command: listOpenCodeSkills')
    await expect(invokePluginHostCommand('saveSkillContent', { projectId: 'P-1' })).rejects.toThrow('Unknown plugin host command: saveSkillContent')
    expect(invoke).not.toHaveBeenCalled()
  })
})
