import { describe, expect, it } from 'vitest'
import {
  agentTerminalSessions,
  regularTerminalSessions,
} from './terminalSessionService'
import {
  getShellLifecycleState,
  getTaskTerminalTabsSession,
  releaseAllForTask,
} from './liveTerminalPool'

describe('live regular terminal client', () => {
  it('binds core callers to the host-owned regular terminal client', () => {
    expect(getTaskTerminalTabsSession).toBe(regularTerminalSessions.getTaskTerminalTabsSession)
    expect(getShellLifecycleState).toBe(regularTerminalSessions.getShellLifecycleState)
    expect(releaseAllForTask).toBe(regularTerminalSessions.releaseAllForTask)
  })

  it('shares lifecycle state with agent terminals without sharing client-owned disposal', () => {
    expect(getTaskTerminalTabsSession).toBe(agentTerminalSessions.getTaskTerminalTabsSession)
    expect(getShellLifecycleState).toBe(agentTerminalSessions.getShellLifecycleState)
    expect(releaseAllForTask).not.toBe(agentTerminalSessions.releaseAllForTask)
  })
})
