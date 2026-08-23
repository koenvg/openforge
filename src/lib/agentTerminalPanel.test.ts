import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  writePty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./terminalPool', () => ({
  getShellLifecycleState: vi.fn(),
  restorePtyInstance: vi.fn(),
}))

import {
  getAgentStageLabel,
  getAgentStatusText,
  hydrateAgentTerminalPtyInstance,
  writeAgentTerminalTranscription,
} from './agentTerminalPanel'
import { writePty } from './ipc'
import { getShellLifecycleState, restorePtyInstance } from './terminalPool'

describe('agent terminal panel helpers', () => {
  it('keeps provider-specific status text configurable', () => {
    expect(getAgentStatusText('idle', 'Claude agent running...')).toBe('No active implementation')
    expect(getAgentStatusText('running', 'Claude agent running...')).toBe('Claude agent running...')
    expect(getAgentStatusText('running', 'Pi agent running...')).toBe('Pi agent running...')
    expect(getAgentStatusText('running', 'Agent running...')).toBe('Agent running...')
    expect(getAgentStatusText('paused', 'Claude agent running...')).toBe('Agent paused')
    expect(getAgentStatusText('complete', 'Agent running...')).toBeNull()
    expect(getAgentStatusText('error', 'Agent running...')).toBe('Error occurred')
  })

  it('formats shared lifecycle stages with provider-specific label maps', () => {
    const lowerCaseLabels = {
      read_ticket: 'reading ticket',
      implement: 'implementing',
      create_pr: 'creating PR',
      address_comments: 'addressing comments',
    }
    const titleCaseLabels = {
      read_ticket: 'Reading Ticket',
      implement: 'Implementing',
      create_pr: 'Creating PR',
      address_comments: 'Addressing Comments',
    }

    expect(getAgentStageLabel('implement', lowerCaseLabels)).toBe('implementing')
    expect(getAgentStageLabel('implement', titleCaseLabels)).toBe('Implementing')
    expect(getAgentStageLabel('custom_stage', lowerCaseLabels)).toBe('custom_stage')
  })

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
