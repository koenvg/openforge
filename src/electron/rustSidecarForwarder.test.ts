import { describe, expect, it } from 'vitest'
import { desktopCommandOwnershipContracts } from '../lib/desktopIpcContract'
import { SIDECAR_BACKED_COMMANDS } from './generatedRustSidecarCommands'
import { isSidecarBackedCommand } from './rustSidecarForwarder'

const rustOwnedCommands = desktopCommandOwnershipContracts
  .filter(contract => contract.owner === 'rust-sidecar')
  .map(contract => contract.ipcCommand)

describe('Rust sidecar command ownership', () => {
  it('has no commands missing from the generated sidecar registry', () => {
    const missing = rustOwnedCommands.filter(command => !SIDECAR_BACKED_COMMANDS.has(command))

    expect(missing).toEqual([])
  })

  it('has no stale commands in the generated sidecar registry', () => {
    const rustOwnedCommandSet = new Set<string>(rustOwnedCommands)
    const stale = [...SIDECAR_BACKED_COMMANDS].filter(command => !rustOwnedCommandSet.has(command))

    expect(stale).toEqual([])
  })

  it('classifies commands from the generated sidecar registry', () => {
    for (const contract of desktopCommandOwnershipContracts) {
      expect(isSidecarBackedCommand(contract.ipcCommand)).toBe(contract.owner === 'rust-sidecar')
    }
  })
})
