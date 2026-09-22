import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createControlledRestartHost } from './controlledRestartHost'
import type { RestartWorkspaceIpc } from './restartWorkspaceIpc'

const images = { app: 'a'.repeat(64), sidecar: 'b'.repeat(64), daemon: 'c'.repeat(64), cli: 'd'.repeat(64), helper: 'e'.repeat(64) }
const controller = { installation: 'installation', lifetime: 'daemon', generation: 1 }

async function capture(host: RestartWorkspaceIpc) {
  let operationId = ''
  host.register(10, 'window', id => {
    operationId = id
    void host.handle(10, 'capture_restart_workspace', {
      operationId: id, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
  })
  await host.handle(10, 'restart_app', {})
  return operationId
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'openforge-update-host-'))
  roots.push(root)
  return root
}

it('refuses an update before capture or handoff when trusted-release verification is unavailable', async () => {
  const root = await fixtureRoot()
  await expect(createControlledRestartHost({
    root, operationId: null, intent: 'update',
    inventory: async () => ({ controller: { installation: 'installation', lifetime: 'daemon', generation: 1 }, sessions: [], hasLegacySessions: false }),
    replace: async () => { throw new Error('must not replace') },
  })).rejects.toThrow('trusted-release verification')
})

it('keeps an update in recovery until every target image is running, then restores and commits', async () => {
  const root = await fixtureRoot()
  let generation = 1
  let runningImages = { ...images, daemon: 'e'.repeat(64) }
  let replacementRequested = false
  const update = {
    preflight: async (identity: { operationId: string; installationId: string }) => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
    replace: async () => { replacementRequested = true },
    readiness: async (target: { operationId: string }) => ({ operationId: target.operationId, images: runningImages, controller: { ...controller, generation }, reconciled: true }),
  }
  const options = {
    root, update,
    inventory: async () => ({ controller: { ...controller, generation }, sessions: [], hasLegacySessions: false }),
    replace: async () => { throw new Error('An update must not use plain restart replacement') },
  }
  const source = await createControlledRestartHost({ ...options, operationId: null, intent: 'update' })
  const operationId = await capture(source)
  expect(replacementRequested).toBe(true)
  generation = 2
  // No update intent on the new process: the persisted operation is authoritative.
  const replacement = await createControlledRestartHost({ ...options, operationId })
  replacement.register(20, 'window', () => {})
  await expect(replacement.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('daemon')
  expect(await replacement.shutdownIntent()).toBe('update')
  expect(await replacement.handle(20, 'get_restart_workspace', {})).not.toBeNull()
  runningImages = { ...images }
  await replacement.handle(20, 'complete_restart_workspace', { operationId })
  expect(await replacement.shutdownIntent()).toBe('quit')
  expect(await replacement.handle(20, 'get_restart_workspace', {})).toBeNull()
})

it('preserves preflight refusal and allows a later retry without preparing or replacing the app', async () => {
  const root = await fixtureRoot()
  let refused = true
  let prepared = false
  let replaced = false
  const host = await createControlledRestartHost({
    root, operationId: null, intent: 'update',
    inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
    backend: { prepare: async () => { prepared = true }, cancel: async () => {}, detach: async () => {}, commit: async () => {} },
    replace: async () => { throw new Error('not an update helper') },
    update: {
      preflight: async identity => {
        if (refused) throw new Error('Publisher signature rejected')
        return { ...identity, manifestSha256: 'f'.repeat(64), images }
      },
      replace: async () => { replaced = true },
      readiness: async target => ({ operationId: target.operationId, controller, images, reconciled: true }),
    },
  })
  let operationId = ''
  host.register(10, 'window', id => {
    operationId = id
    void host.handle(10, 'capture_restart_workspace', { operationId: id, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] } })
  })
  await expect(host.handle(10, 'restart_app', {})).rejects.toThrow('Publisher signature rejected')
  expect(operationId).toBe('')
  expect(prepared).toBe(false)
  expect(replaced).toBe(false)
  expect(await host.shutdownIntent()).toBe('quit')
  refused = false
  await host.handle(10, 'restart_app', {})
  expect(replaced).toBe(true)
})

async function preparedUpdate() {
  const root = await fixtureRoot()
  const state = { generation: 1, failCommit: false, commits: 0 }
  const update = {
    preflight: async (identity: { operationId: string; installationId: string }) => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
    replace: async () => {},
    readiness: async (target: { operationId: string }) => ({ operationId: target.operationId, images, controller: { ...controller, generation: state.generation }, reconciled: true }),
  }
  const options = {
    root, update, replace: async () => {},
    inventory: async () => ({ controller: { ...controller, generation: state.generation }, sessions: [], hasLegacySessions: false }),
    backend: {
      prepare: async () => {}, cancel: async () => {}, detach: async () => {},
      commit: async () => {
        if (state.failCommit) throw new Error('Commit acknowledgement lost')
        state.commits++
      },
    },
  }
  const operationId = await capture(await createControlledRestartHost({ ...options, operationId: null, intent: 'update' }))
  state.generation = 2
  return { options, operationId, state }
}

it('cannot downgrade an incomplete update to a restart by omitting the update driver', async () => {
  const { options, operationId, state } = await preparedUpdate()
  const host = await createControlledRestartHost({ ...options, update: undefined, operationId })
  host.register(20, 'window', () => {})
  await expect(host.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('trusted-release verification')
  expect(state.commits).toBe(0)
  expect(await host.shutdownIntent()).toBe('update')
})

it('rechecks executable identities after a lost commit acknowledgement and another relaunch', async () => {
  const { options, operationId, state } = await preparedUpdate()
  const host = await createControlledRestartHost({ ...options, operationId })
  host.register(20, 'window', () => {})
  state.failCommit = true
  await expect(host.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('Commit acknowledgement lost')
  state.failCommit = false
  state.generation = 3
  const readiness = options.update.readiness
  options.update.readiness = async target => ({ ...await readiness(target), images: { ...images, cli: '0'.repeat(64) } })
  await expect(createControlledRestartHost({ ...options, operationId })).rejects.toThrow('cli')
  expect(state.commits).toBe(0)
  options.update.readiness = readiness
  const recovered = await createControlledRestartHost({ ...options, operationId })
  expect(await recovered.shutdownIntent()).toBe('quit')
  expect(await recovered.launchWindowIds()).not.toContain('window')
  expect(state.commits).toBe(1)
})

it.each(['app', 'sidecar', 'cli', 'helper'] as const)('refuses completion while the %s executable is still old', async component => {
  const { options, operationId, state } = await preparedUpdate()
  const readiness = options.update.readiness
  options.update.readiness = async target => ({ ...await readiness(target), images: { ...images, [component]: '0'.repeat(64) } })
  const host = await createControlledRestartHost({ ...options, operationId })
  host.register(20, 'window', () => {})
  await expect(host.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow(component)
  expect(state.commits).toBe(0)
  expect(await host.handle(20, 'get_restart_workspace', {})).not.toBeNull()
})

it.each(['operation', 'installation', 'lifetime', 'generation', 'reconciliation'])('refuses stale %s readiness evidence', async field => {
  const { options, operationId, state } = await preparedUpdate()
  const readiness = options.update.readiness
  options.update.readiness = async target => {
    const evidence = await readiness(target)
    if (field === 'operation') evidence.operationId = 'other'
    if (field === 'installation') evidence.controller.installation = 'other'
    if (field === 'lifetime') evidence.controller.lifetime = 'other'
    if (field === 'generation') evidence.controller.generation = 99
    if (field === 'reconciliation') evidence.reconciled = false
    return evidence
  }
  const host = await createControlledRestartHost({ ...options, operationId })
  host.register(20, 'window', () => {})
  await expect(host.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('readiness or reconciliation')
  expect(state.commits).toBe(0)
  expect(await host.shutdownIntent()).toBe('update')
})
