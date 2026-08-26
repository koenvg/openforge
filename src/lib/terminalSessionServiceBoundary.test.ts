import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  agentTerminalSessions,
  regularTerminalSessions,
} from './terminalSessionService'
import {
  getShellLifecycleState as liveGetShellLifecycleState,
  getTaskTerminalTabsSession as liveGetTaskTerminalTabsSession,
} from './liveTerminalPool'
import { getBuiltinPluginModule } from './plugin/builtinPluginModules'
import {
  getShellLifecycleState as pluginGetShellLifecycleState,
  getTaskTerminalTabsSession as pluginGetTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'

describe('host Terminal Session Service boundary', () => {
  it('owns the only production Terminal Runtime used by agent and regular plugin terminals', () => {
    const serviceSource = readFileSync(join(process.cwd(), 'src/lib/terminalSessionService.ts'), 'utf8')
    const agentFacadeSource = readFileSync(join(process.cwd(), 'src/lib/terminalPool.ts'), 'utf8')
    const pluginFacadeSource = readFileSync(join(process.cwd(), 'plugins/terminal/src/lib/terminalPool.ts'), 'utf8')
    const builtinModulesSource = readFileSync(join(process.cwd(), 'src/lib/plugin/builtinPluginModules.ts'), 'utf8')

    expect(serviceSource).toContain('createTerminalRuntime(')
    expect(agentFacadeSource).not.toContain('createTerminalRuntime(')
    expect(pluginFacadeSource).not.toContain('createTerminalRuntime(')
    expect(pluginFacadeSource).not.toContain("from './ipc'")
    expect(pluginFacadeSource).not.toContain('XTERM_AUTHORITATIVE_TERMINAL_CONTRACT')
    expect(builtinModulesSource).toContain('configureTerminalSessionClient(regularTerminalSessions)')
  })

  it('routes core observers to the regular terminal client without a plugin-owned bridge registry', () => {
    expect(liveGetShellLifecycleState).toBe(regularTerminalSessions.getShellLifecycleState)
    expect(liveGetTaskTerminalTabsSession).toBe(regularTerminalSessions.getTaskTerminalTabsSession)
    expect(agentTerminalSessions.getShellLifecycleState).toBe(regularTerminalSessions.getShellLifecycleState)
    expect(agentTerminalSessions.getTaskTerminalTabsSession).toBe(regularTerminalSessions.getTaskTerminalTabsSession)
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
