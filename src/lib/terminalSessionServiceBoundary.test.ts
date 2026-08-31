import { describe, expect, it } from 'vitest'
import {
  agentTerminalSessions,
  getTerminalRuntimeForTests,
  regularTerminalSessions,
} from './terminalSessionService'
import { getBuiltinPluginModule } from './plugin/builtinPluginModules'
import { desktopTerminalSurfaceAdapter } from '../components/task-detail/terminalSurfaceAdapter'
import {
  getShellLifecycleState as pluginGetShellLifecycleState,
  getTaskTerminalTabsSession as pluginGetTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'

describe('host Terminal Session Service boundary', () => {
  it('uses the regular-terminal client for desktop Terminal Surfaces', () => {
    expect(desktopTerminalSurfaceAdapter.runtime).toBe(regularTerminalSessions)
  })

  it('backs both owner-scoped clients with the host Terminal Runtime', () => {
    const runtime = getTerminalRuntimeForTests()

    expect(agentTerminalSessions).not.toBe(regularTerminalSessions)
    expect(agentTerminalSessions.hasTerminal).toBe(runtime.hasTerminal)
    expect(regularTerminalSessions.hasTerminal).toBe(runtime.hasTerminal)
    expect(agentTerminalSessions.acquire).not.toBe(regularTerminalSessions.acquire)
    expect(agentTerminalSessions.release).not.toBe(regularTerminalSessions.release)
  })

  it('shares runtime observations without sharing owner-scoped release operations', () => {
    expect(agentTerminalSessions.getShellLifecycleState).toBe(regularTerminalSessions.getShellLifecycleState)
    expect(agentTerminalSessions.getTaskTerminalTabsSession).toBe(regularTerminalSessions.getTaskTerminalTabsSession)
    expect(agentTerminalSessions.releaseAllForTask).not.toBe(regularTerminalSessions.releaseAllForTask)
  })

  it('injects the regular terminal client into the built-in plugin facade', () => {
    expect(getBuiltinPluginModule('com.openforge.terminal')).toBeDefined()
    expect(pluginGetShellLifecycleState('T-1-shell-0')).toEqual(
      regularTerminalSessions.getShellLifecycleState('T-1-shell-0'),
    )
    expect(pluginGetTaskTerminalTabsSession('T-1')).toEqual(
      regularTerminalSessions.getTaskTerminalTabsSession('T-1'),
    )
  })
})
