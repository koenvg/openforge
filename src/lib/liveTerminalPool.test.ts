import { describe, expect, it } from 'vitest'
import {
  getShellLifecycleState as appGetShellLifecycleState,
  getTaskTerminalTabsSession as appGetTaskTerminalTabsSession,
} from './terminalPool'
import {
  getShellLifecycleState as pluginGetShellLifecycleState,
  getTaskTerminalTabsSession as pluginGetTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'
import { getShellLifecycleState, getTaskTerminalTabsSession } from './liveTerminalPool'

// Regression guard for the "Run app hangs" bug: the task-view terminal is rendered
// by the terminal PLUGIN, which owns its own createTerminalRuntime instance. Any code
// that drives that terminal (e.g. the Run app button) must read session/lifecycle from
// the PLUGIN runtime, not the app-local src/lib/terminalPool (a different instance).
describe('liveTerminalPool bridge', () => {
  it('binds to the terminal plugin runtime that renders the task-view terminal', () => {
    expect(getTaskTerminalTabsSession).toBe(pluginGetTaskTerminalTabsSession)
    expect(getShellLifecycleState).toBe(pluginGetShellLifecycleState)
  })

  it('does not bind to the app-local terminal pool (a separate runtime instance)', () => {
    expect(getTaskTerminalTabsSession).not.toBe(appGetTaskTerminalTabsSession)
    expect(getShellLifecycleState).not.toBe(appGetShellLifecycleState)
  })
})
