import { describe, expect, it } from 'vitest'
import * as compatibilityIpc from './ipc'
import * as agentSessionsIpc from './ipc/agentSessions'
import * as appLifecycleIpc from './ipc/appLifecycle'
import * as audioTranscriptionIpc from './ipc/audioTranscription'
import * as companionIpc from './ipc/companion'
import * as configIpc from './ipc/config'
import * as filesystemIpc from './ipc/filesystem'
import * as githubIpc from './ipc/github'
import * as pluginManagementIpc from './ipc/pluginManagement'
import * as taskIpc from './ipc/tasks'
import * as terminalIpc from './ipc/terminal'

const domainModules = {
  agentSessions: agentSessionsIpc,
  appLifecycle: appLifecycleIpc,
  audioTranscription: audioTranscriptionIpc,
  companion: companionIpc,
  config: configIpc,
  filesystem: filesystemIpc,
  github: githubIpc,
  pluginManagement: pluginManagementIpc,
  tasks: taskIpc,
  terminal: terminalIpc,
}

function functionEntries(module: Record<string, unknown>): [string, Function][] {
  return Object.entries(module)
    .filter((entry): entry is [string, Function] => typeof entry[1] === 'function')
    .sort(([left], [right]) => left.localeCompare(right))
}

describe('IPC module boundaries', () => {
  it('assigns every typed wrapper to exactly one domain module', () => {
    const owners = new Map<string, string>()

    for (const [moduleName, module] of Object.entries(domainModules)) {
      for (const [functionName] of functionEntries(module)) {
        expect(owners.get(functionName), `${functionName} is exported by multiple IPC modules`).toBeUndefined()
        owners.set(functionName, moduleName)
      }
    }

    expect([...owners.keys()].sort((left, right) => left.localeCompare(right))).toEqual(
      functionEntries(compatibilityIpc).map(([functionName]) => functionName),
    )
  })

  it('keeps ipc.ts exports as identity-preserving compatibility re-exports', () => {
    for (const module of Object.values(domainModules)) {
      for (const [functionName, wrapper] of functionEntries(module)) {
        expect(compatibilityIpc[functionName as keyof typeof compatibilityIpc]).toBe(wrapper)
      }
    }
  })
})
