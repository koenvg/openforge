import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@babel/parser'
import { publicCommandContracts } from '../../scripts/generate-desktop-ipc-registry.mjs'
import { describe, expect, it } from 'vitest'
import { isElectronShellCommand } from '../electron/electronShellCommandHandler'
import { internalSidecarCommandRegistrations } from '../electron/internalSidecarCommandRegistrations'
import * as ipc from './ipc'
import { desktopIpcFunctionDomains } from './desktopIpcDomains'
import {
  desktopCommandContracts,
  desktopCommandOwnershipContracts,
} from './desktopIpcContract'

function parseIpcInvokeContracts() {
  const sourceDirectory = resolve(process.cwd(), 'src/lib/ipc')
  return readdirSync(sourceDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const sourceText = readFileSync(resolve(sourceDirectory, entry.name), 'utf8')
      const sourceFile = parse(sourceText, { sourceType: 'module', plugins: ['typescript'] })
      return publicCommandContracts(sourceFile, entry.name.slice(0, -3))
    })
}

describe('Desktop IPC contract', () => {
  it('lists every public runtime ipc.ts function export', () => {
    const exportedFunctions = Object.entries(ipc)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()

    expect(desktopCommandContracts.map(contract => contract.functionName).sort()).toEqual(exportedFunctions)
  })

  it('keeps generated domain metadata aligned with public wrappers', () => {
    const generatedDomains = Object.fromEntries(
      desktopCommandContracts.map(contract => [contract.functionName, contract.domain]),
    )

    expect(generatedDomains).toEqual(desktopIpcFunctionDomains)
  })

  it('locks domain IPC module ownership, command names, and top-level payload keys', () => {
    const parsedContracts = parseIpcInvokeContracts()
      .map(contract => [contract.functionName, contract] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const declaredContracts = desktopCommandContracts
      .map(({ functionName, moduleName, ipcCommand, payloadKeys }) => [
        functionName,
        { functionName, moduleName, ipcCommand, payloadKeys: [...payloadKeys] },
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right))

    expect(declaredContracts).toEqual(parsedContracts)
  })

  it('locks internal desktop command ownership outside the public domain wrappers', () => {
    const publicCommands = new Set<string>(desktopCommandContracts.map(contract => contract.ipcCommand))
    const internalContracts = desktopCommandOwnershipContracts
      .filter(contract => !publicCommands.has(contract.ipcCommand))
      .map(({ ipcCommand, owner, domain }) => ({ ipcCommand, owner, domain }))

    expect(internalContracts).toEqual(internalSidecarCommandRegistrations.map(contract => ({
      ...contract,
      owner: 'rust-sidecar',
    })))
    expect(new Set(desktopCommandOwnershipContracts.map(contract => contract.ipcCommand)).size)
      .toBe(desktopCommandOwnershipContracts.length)
  })


  it('derives Electron main versus Rust sidecar ownership from Electron command registrations', () => {
    for (const contract of desktopCommandContracts) {
      expect(contract.owner).toBe(
        isElectronShellCommand(contract.ipcCommand) ? 'electron-main' : 'rust-sidecar',
      )
    }
  })
})
