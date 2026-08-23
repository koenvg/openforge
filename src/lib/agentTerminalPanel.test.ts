import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./terminalPool', () => ({
  getShellLifecycleState: vi.fn(),
  restorePtyInstance: vi.fn(),
}))

import {
  hydrateAgentTerminalPtyInstance,
  writeAgentTerminalTranscription,
} from './agentTerminalPanel'
import { writePty } from './ipc'
import { getShellLifecycleState, restorePtyInstance } from './terminalPool'

describe('agent terminal panel lifecycle', () => {
  it('writes transcription only when terminalPool reports an active PTY', async () => {
    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: false, shellExited: false, currentPtyInstance: null, hasOutput: false })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).not.toHaveBeenCalled()

    vi.mocked(getShellLifecycleState).mockReturnValue({ ptyActive: true, shellExited: false, currentPtyInstance: null, hasOutput: false })
    await writeAgentTerminalTranscription('T-1', 'hello', 'TestPanel')
    expect(writePty).toHaveBeenCalledWith('T-1', 'hello')
  })

  it('restores current PTY instance through terminalPool lifecycle ownership', () => {
    hydrateAgentTerminalPtyInstance('T-1', 123)

    expect(restorePtyInstance).toHaveBeenCalledWith('T-1', 123)
  })
})
