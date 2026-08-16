import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { AgentSession } from '../../lib/types'

type DesktopEventCallback = (event: { payload: unknown }) => void

// Mock xterm.js — provide a minimal Terminal stub
vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    cols: 80,
    rows: 24,
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  }))
  return { FitAddon }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

vi.mock('../../lib/stores', () => ({
  activeSessions: writable(new Map()),
}))

vi.mock('../../lib/ipc', () => ({
  getLatestSession: vi.fn().mockResolvedValue(null),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

// Mock terminalPool to avoid xterm constructor issues in test environment
const { listenCallbacks, mockPoolEntry, mockShellLifecycleState } = vi.hoisted(() => ({
  listenCallbacks: new Map<string, DesktopEventCallback[]>(),
  mockPoolEntry: {
    taskId: '',
    terminal: { write: vi.fn(), dispose: vi.fn(), reset: vi.fn(), cols: 80, rows: 24 },
    fitAddon: { fit: vi.fn(), proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }) },
    hostDiv: document.createElement('div'),
    ptyActive: false,
    needsClear: false,
    unlisteners: [] as Array<() => void>,
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  },
  mockShellLifecycleState: {
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null as number | null,
  },
}))



vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockImplementation((eventName: string, cb: DesktopEventCallback) => {
    const existing = listenCallbacks.get(eventName) || []
    existing.push(cb)
    listenCallbacks.set(eventName, existing)
    return Promise.resolve(() => {})
  }),
}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mockPoolEntry),
  attach: vi.fn(),
  detach: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
  getShellLifecycleState: vi.fn().mockImplementation(() => ({ ...mockShellLifecycleState })),
  isPtyActive: vi.fn().mockImplementation(() => mockShellLifecycleState.ptyActive),
  isValidTerminalDimensions: vi.fn().mockReturnValue(true),
  updateShellLifecycleState: vi.fn().mockImplementation((_taskId: string, state: typeof mockShellLifecycleState) => {
    mockShellLifecycleState.ptyActive = state.ptyActive
    mockShellLifecycleState.shellExited = state.shellExited
    mockShellLifecycleState.currentPtyInstance = state.currentPtyInstance
  }),
  _getPool: vi.fn().mockReturnValue(new Map()),
}))

import AgentPanel from './AgentPanel.svelte'
import { activeSessions } from '../../lib/stores'

describe('AgentPanel (router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('renders OpenCode panel by default when no session exists without a separate history-loading overlay', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    // Wait for async onMount to complete
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
    expect(screen.queryByText('Loading session output...')).toBeNull()
  })

  it('shows guidance text via OpenCode panel', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
    })
  })

  it('shows OpenCode panel for opencode provider session', async () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
      pi_session_id: null,
      grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('opencode-agent-panel')).toBeTruthy()
  })

  it('routes pi provider sessions through the shared terminal shell', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'pi',
      claude_session_id: null,
      pi_session_id: 'pi-sess-1',
      grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('pi-agent-panel')).toBeTruthy()
  })

  it('routes codex provider sessions through the shared terminal shell', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'codex-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'codex',
      claude_session_id: null,
      pi_session_id: null,
      grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('codex-agent-panel')).toBeTruthy()
  })

  it('resolves the grok session key for grok provider sessions', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'grok',
      claude_session_id: null,
      pi_session_id: null,
      grok_session_id: 'grok-sess-1',
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('grok-agent-panel')).toBeTruthy()
  })

})

describe('AgentPanel starting animation', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('shows starting animation when isStarting=true and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    await vi.waitFor(() => {
      expect(screen.getByText('Starting agent session...')).toBeTruthy()
      expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('shows idle state when isStarting=false and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: false } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
      expect(screen.queryByText('Starting agent session...')).toBeNull()
    })
  })

  it('hides starting animation when session exists', async () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    expect(screen.queryByText('Starting agent session...')).toBeNull()
  })
})

describe('OpenCode shared shell (via router)', () => {
  beforeEach(() => {
    activeSessions.set(new Map())
    listenCallbacks.clear()
    mockPoolEntry.ptyActive = false
    mockPoolEntry.needsClear = false
    mockShellLifecycleState.ptyActive = false
    mockShellLifecycleState.shellExited = false
    mockShellLifecycleState.currentPtyInstance = null
    vi.clearAllMocks()
  })

  it('calls attach with the pooled terminal entry for OpenCode sessions', async () => {
    const { attach } = await import('../../lib/terminalPool')

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not expose an Abort action for a running agent session', async () => {
    const { attach } = await import('../../lib/terminalPool')

    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: 'oc-sess-1',
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
      pi_session_id: null,
      grok_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(screen.queryByRole('button', { name: 'Abort' })).toBeNull()
  })

  it('shows question banner when session is paused with checkpoint_data', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"properties":{"description":"Allow file write to src/main.ts?"}}',
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Allow file write to src/main.ts?')).toBeTruthy()
  })

  it('shows generic fallback banner when checkpoint_data has no known fields', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it('does not show question banner for dedicated PTY instance metadata', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: 42,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
      pi_session_id: null,
      grok_session_id: null,
    }

    activeSessions.set(new Map([['T-1', session]]))

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show question banner when session is running', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'running',
      checkpoint_data: null,
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show question banner when no session exists', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.queryByText('Agent is waiting for input')).toBeNull()
    })
  })

  it('shows question text from question.asked event format', () => {
    const session: AgentSession = {
      id: 'ses-1',
      ticket_id: 'T-1',
      opencode_session_id: null,
      stage: 'implement',
      status: 'paused',
      checkpoint_data: JSON.stringify({
        type: 'question.asked',
        properties: {
          id: 'que_abc',
          sessionID: 'ses_xyz',
          questions: [{ question: 'Run or Bike?', header: 'Run or Bike', options: [] }]
        }
      }),
      pty_instance_id: null,
      error_message: null,
      created_at: 1000,
      updated_at: 2000,
      provider: 'opencode',
      claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    }

    const sessions = new Map<string, AgentSession>()
    sessions.set('T-1', session)
    activeSessions.set(sessions)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Run or Bike?')).toBeTruthy()
  })
})
