import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listenCallbacks, resetAgentIpcMocks } from './agentIpcMocks.testUtils'
import { resetActiveSessions, setActiveSession } from './activeAgentSessions.testUtils'
import {
  mockAttachment,
  mockPoolEntry,
  mockShellLifecycleState,
  resetAgentTerminalMocks,
} from './agentTerminalMocks.testUtils'
import { createAgentSession } from './agentSession.testFixtures'
import AgentTerminalShell from './AgentTerminalShell.svelte'

const baseSession = createAgentSession({ provider: 'pi' })

describe('AgentTerminalShell', () => {
  beforeEach(() => {
    resetActiveSessions()
    resetAgentIpcMocks()
    resetAgentTerminalMocks()
    vi.clearAllMocks()
  })

  it.each([
    {
      providerName: 'Pi',
      session: createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-abc123' }),
      sessionIdKey: 'pi_session_id' as const,
    },
    {
      providerName: 'Claude',
      session: createAgentSession({ provider: 'claude-code', claude_session_id: 'claude-sess-abc123' }),
      sessionIdKey: 'claude_session_id' as const,
    },
    {
      providerName: 'OpenCode',
      session: createAgentSession({ provider: 'opencode', opencode_session_id: 'opencode-sess-abc123' }),
      sessionIdKey: 'opencode_session_id' as const,
    },
  ])('keeps the pooled terminal attached across $providerName unmount/remount without clearing or killing the PTY', async ({
    session,
    sessionIdKey,
  }) => {
    setActiveSession(session)
    mockShellLifecycleState.ptyActive = true

    const { acquire, attach, release } = await import('../../lib/terminalPool')
    const { killPty } = await import('../../lib/ipc')

    const firstRender = render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey,
      },
    })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })

    firstRender.unmount()
    expect(mockAttachment.detach).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    expect(killPty).not.toHaveBeenCalled()
    expect(mockPoolEntry.view.reset).not.toHaveBeenCalled()
    expect(mockPoolEntry.view.dispose).not.toHaveBeenCalled()

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey,
      },
    })

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(2)
      expect(attach).toHaveBeenCalledTimes(2)
      expect(attach).toHaveBeenLastCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(release).not.toHaveBeenCalled()
    expect(killPty).not.toHaveBeenCalled()
    expect(mockPoolEntry.view.reset).not.toHaveBeenCalled()
    expect(mockPoolEntry.view.dispose).not.toHaveBeenCalled()
  })

  it('hydrates PTY instance metadata from status events while preserving active pooled terminal state', async () => {
    setActiveSession(createAgentSession({ provider: 'opencode', opencode_session_id: 'opencode-sess-abc123' }))
    mockShellLifecycleState.ptyActive = true

    const { restorePtyInstance } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    await vi.waitFor(() => {
      expect(listenCallbacks.get('agent-status-changed')?.length).toBe(1)
    })

    listenCallbacks.get('agent-status-changed')?.[0]?.({
      payload: { task_id: 'T-1', status: 'running', pty_instance_id: 42 },
    })

    expect(restorePtyInstance).toHaveBeenCalledWith('T-1', 42)
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('hydrates the persisted PTY instance before attaching a resumed Agent Session', async () => {
    setActiveSession(createAgentSession({ provider: 'pi', pty_instance_id: 42 }))
    const { attach, restorePtyInstance } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'pi_session_id',
      },
    })

    await vi.waitFor(() => {
      expect(restorePtyInstance).toHaveBeenCalledWith('T-1', 42)
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(vi.mocked(restorePtyInstance)).toHaveBeenCalledBefore(vi.mocked(attach))
  })

  it.each(['completed', 'failed', 'interrupted'])(
    'does not restore stale persisted PTY metadata for a %s Agent Session',
    async (status) => {
      setActiveSession(createAgentSession({ provider: 'pi', status, pty_instance_id: 42 }))
      const { attach, restorePtyInstance } = await import('../../lib/terminalPool')

      render(AgentTerminalShell, {
        props: {
          taskId: 'T-1',
          sessionIdKey: 'pi_session_id',
        },
      })

      await vi.waitFor(() => {
        expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
      })
      expect(restorePtyInstance).not.toHaveBeenCalled()
    },
  )

  it('mounts the pooled terminal shell for an active session', async () => {
    setActiveSession(baseSession)

    const { acquire, attach } = await import('../../lib/terminalPool')

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'pi_session_id',
        rootTestId: 'pi-agent-panel',
      },
    })

    expect(screen.getByTestId('pi-agent-panel')).toBeTruthy()
    expect(document.querySelector('.shell-terminal-wrapper')).toBeTruthy()

    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledWith('T-1')
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('refits only while the Agent workbench remains active', async () => {
    setActiveSession(baseSession)
    const { attach } = await import('../../lib/terminalPool')

    const view = render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'pi_session_id',
        isActive: false,
      },
    })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(mockAttachment.refit).not.toHaveBeenCalled()

    await view.rerender({
      taskId: 'T-1',
      sessionIdKey: 'pi_session_id',
      isActive: true,
    })

    await vi.waitFor(() => {
      expect(mockAttachment.refit).toHaveBeenCalledWith(expect.any(AbortSignal))
    })

    const recoverySignal = vi.mocked(mockAttachment.refit).mock.calls[0]?.[0]
    expect(recoverySignal?.aborted).toBe(false)

    await view.rerender({
      taskId: 'T-1',
      sessionIdKey: 'pi_session_id',
      isActive: false,
    })
    expect(recoverySignal?.aborted).toBe(true)
  })

  it('leaves the agent PTY palette under the shared app theme runtime', async () => {
    setActiveSession(baseSession)

    const { attach } = await import('../../lib/terminalPool')
    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'pi_session_id',
      },
    })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(mockPoolEntry.view.setTheme).not.toHaveBeenCalled()
  })

  it('keeps an active pooled PTY visible without persisted session state', () => {
    mockShellLifecycleState.ptyActive = true

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'pi_session_id',
      },
    })

    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('shows the shared starting empty state when no session is active', async () => {
    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        isStarting: true,
        sessionIdKey: 'claude_session_id',
      },
    })

    expect(await screen.findByText('Starting agent session...')).toBeTruthy()
    expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
    expect(screen.queryByText('No active agent session')).toBeNull()
  })

  it('shows OpenCode question pauses as a checkpoint question bar', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      opencode_session_id: 'opencode-sess-abc123',
      checkpoint_data: '{"type":"question.asked","properties":{"description":"Which branch should I use?"}}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    expect(screen.getByText('Which branch should I use?')).toBeTruthy()
  })

  it('shows OpenCode checkpoint question text from the shared terminal shell', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      opencode_session_id: 'opencode-sess-abc123',
      checkpoint_data: '{"properties":{"description":"Allow file write to src/main.ts?"}}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    expect(screen.getByText('Allow file write to src/main.ts?')).toBeTruthy()
  })

  it('shows the generic checkpoint fallback for unknown OpenCode payloads', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it('shows the generic checkpoint fallback for unknown PTY-shaped checkpoint payloads', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"pty_instance_id":42}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it('does not show a checkpoint banner for OpenCode sessions unless they are paused', () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'running',
      checkpoint_data: '{"unknown":"data"}',
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('refits the terminal when an OpenCode checkpoint banner is removed', async () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: null,
    }))

    render(AgentTerminalShell, {
      props: {
        taskId: 'T-1',
        sessionIdKey: 'opencode_session_id',
      },
    })

    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
    }))

    expect(await screen.findByText('Agent is waiting for input')).toBeTruthy()
    await vi.waitFor(() => {
      expect(mockPoolEntry.view.fit).toHaveBeenCalled()
    })
    vi.mocked(mockPoolEntry.view.fit).mockClear()

    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: null,
      pty_instance_id: 42,
    }))

    await vi.waitFor(() => {
      expect(screen.queryByText('Agent is waiting for input')).toBeNull()
    })
    await vi.waitFor(() => {
      expect(mockPoolEntry.view.fit).toHaveBeenCalled()
    })
  })
})
