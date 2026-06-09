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
