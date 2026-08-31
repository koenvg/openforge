import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./terminalSessionService', () => {
  const agentTerminalSessions = {
    getShellLifecycleState: vi.fn(),
    restorePtyInstance: vi.fn(),
  }
  return {
    agentTerminalSessions,
    regularTerminalSessions: { ...agentTerminalSessions },
  }
})

import {
  hydrateAgentTerminalPtyInstance,
  writeAgentTerminalTranscription,
} from './agentTerminalPanel'
import { writePty } from './ipc'
import { agentTerminalSessions } from './terminalSessionService'
const { getShellLifecycleState, restorePtyInstance } = agentTerminalSessions

describe('agent terminal panel lifecycle', () => {
  it('writes transcription only when the agent Terminal Session reports an active PTY', async () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: false, shellExited: false, currentPtyInstance: null, hasOutput: false })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).not.toHaveBeenCalled()

    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: true, shellExited: false, currentPtyInstance: null, hasOutput: false })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).toHaveBeenCalledWith('T-1', 'hello')
  })

  it('restores current PTY instance through agent Terminal Session lifecycle ownership', () => {
    hydrateAgentTerminalPtyInstance('T-1', 123)

    expect(restorePtyInstance).toHaveBeenCalledWith('T-1', 123)
  })
})
