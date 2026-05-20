import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokePluginHostCommand } from './pluginHostCommands'

function installDesktopBridge(result: unknown = []): { invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn().mockResolvedValue(result)
  window.openforge = {
    version: 1,
    invoke,
    onEvent: vi.fn(() => vi.fn()),
  }
  return { invoke }
}

describe('plugin host GitHub agent review commands', () => {
  beforeEach(() => {
    delete window.openforge
  })

  it('keeps persisted inline agent comment commands available to plugins', async () => {
    const { invoke } = installDesktopBridge([])

    await invokePluginHostCommand('getAgentReviewComments', { reviewPrId: '42' })
    expect(invoke).toHaveBeenLastCalledWith('get_agent_review_comments', { reviewPrId: 42 })

    await invokePluginHostCommand('updateAgentReviewCommentStatus', { commentId: '7', status: 'approved' })
    expect(invoke).toHaveBeenLastCalledWith('update_agent_review_comment_status', { commentId: 7, status: 'approved' })
  })

  it('exposes narrow task creation and agent-run host commands to trusted plugins', async () => {
    const { invoke } = installDesktopBridge()
    invoke.mockImplementation(async (command: string) => command === 'create_task'
      ? { id: 'T-1', initial_prompt: 'Schedule native run', prompt: null, summary: null, status: 'backlog', agent: null, permission_mode: 'default', depends_on: ['T-0'], project_id: 'P-1', created_at: 1, updated_at: 2 }
      : { task_id: 'T-1', workspace_path: '/repo/T-1', port: 0, session_id: 'session-1' })

    await invokePluginHostCommand('createTask', {
      initialPrompt: 'Schedule native run',
      status: 'backlog',
      projectId: 'P-1',
      permissionMode: 'default',
      dependsOn: ['T-0'],
      labelNames: ['scheduler'],
    })
    expect(invoke).toHaveBeenLastCalledWith('create_task', {
      initialPrompt: 'Schedule native run',
      status: 'backlog',
      projectId: 'P-1',
      permissionMode: 'default',
      dependsOn: ['T-0'],
      labelNames: ['scheduler'],
    })

    await invokePluginHostCommand('startImplementation', {
      taskId: 'T-1',
      projectId: 'P-1',
      provider: 'opencode',
      agent: 'build',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
      permissionMode: 'default',
      actionPrompt: 'Implement it',
    })
    expect(invoke).toHaveBeenLastCalledWith('plugin_start_implementation', {
      taskId: 'T-1',
      projectId: 'P-1',
      provider: 'opencode',
      agent: 'build',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
      permissionMode: 'default',
      actionPrompt: 'Implement it',
    })

    await invokePluginHostCommand('resumeImplementation', {
      taskId: 'T-1',
      sessionId: 'session-1',
      provider: 'opencode',
      actionPrompt: 'Continue',
    })
    expect(invoke).toHaveBeenLastCalledWith('resume_implementation', {
      taskId: 'T-1',
      sessionId: 'session-1',
      provider: 'opencode',
      actionPrompt: 'Continue',
    })
  })

  it('does not expose removed live agent review start/abort host commands', async () => {
    const { invoke } = installDesktopBridge()

    await expect(invokePluginHostCommand('startAgentReview', { reviewPrId: 42 })).rejects.toThrow('Unknown plugin host command: startAgentReview')
    await expect(invokePluginHostCommand('abortAgentReview', { reviewSessionKey: 'review-42' })).rejects.toThrow('Unknown plugin host command: abortAgentReview')
    expect(invoke).not.toHaveBeenCalled()
  })
})
