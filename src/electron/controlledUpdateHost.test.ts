import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { UpdateSidecarExit } from './updateSidecarExit'
import { asChildProcessLike, createSidecarLaunchConfig } from './sidecar'
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
    cancel: async () => {},
    commit: async () => {},
    preflight: async (identity: { operationId: string; installationId: string }) => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
    prepare: async () => {},
    replace: async () => { replacementRequested = true },
    readiness: async (target: { operationId: string }) => ({ operationId: target.operationId, images: runningImages, controller: { ...controller, generation }, reconciled: true }),
  }
  const options = {
    root, update,
    backend: { prepare: async () => {}, cancel: async () => {}, detach: async () => {}, commit: async () => {}, stopForUpdate: async () => {} },
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
    backend: { prepare: async () => { prepared = true }, cancel: async () => {}, detach: async () => {}, commit: async () => {}, stopForUpdate: async () => {} },
    replace: async () => { throw new Error('not an update helper') },
    update: {
      prepare: async () => {},
      cancel: async () => {},
      commit: async () => {},
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
    cancel: async () => {},
    commit: async () => {},
    preflight: async (identity: { operationId: string; installationId: string }) => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
    prepare: async () => {},
    replace: async () => {},
    readiness: async (target: { operationId: string }) => ({ operationId: target.operationId, images, controller: { ...controller, generation: state.generation }, reconciled: true }),
  }
  const options = {
    root, update, replace: async () => {},
    inventory: async () => ({ controller: { ...controller, generation: state.generation }, sessions: [], hasLegacySessions: false }),
    backend: {
      prepare: async () => {}, cancel: async () => {}, detach: async () => {},
      stopForUpdate: async () => {},
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
  expect(await recovered.shutdownIntent()).toBe('update')
  expect(await recovered.launchWindowIds()).toEqual(['window'])
  expect(state.commits).toBe(0)
  recovered.register(30, 'window', () => {})
  expect(await recovered.handle(30, 'get_restart_workspace', {})).not.toBeNull()
  await recovered.handle(30, 'complete_restart_workspace', { operationId })
  expect(await recovered.shutdownIntent()).toBe('quit')
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

it.each([false, true])('releases the prepared helper on preparation failure, including a lost cancellation reply: %s', async cancelFails => {
  const root = await fixtureRoot()
  let helperOwned = false
  const host = await createControlledRestartHost({
    root, operationId: null, intent: 'update',
    inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
    replace: async () => { throw new Error('plain restart is forbidden') },
    backend: { prepare: async () => { throw new Error('drain refused') }, cancel: async () => { if (cancelFails) throw new Error('cancel outcome unknown') }, detach: async () => {}, commit: async () => {}, stopForUpdate: async () => {} },
    update: {
      preflight: async identity => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
      prepare: async () => { helperOwned = true },
      cancel: async () => { helperOwned = false },
      commit: async () => {},
      replace: async () => { throw new Error('must not replace') },
      readiness: async target => ({ operationId: target.operationId, controller, images, reconciled: true }),
    },
  })
  host.register(10, 'window', () => { throw new Error('must not capture') })
  await expect(host.handle(10, 'restart_app', {})).rejects.toThrow(cancelFails ? 'cancel outcome unknown' : 'drain refused')
  expect(helperOwned).toBe(false)
  if (!cancelFails) expect(await host.shutdownIntent()).toBe('quit')
})

it('keeps the update recoverable until durable helper commit acknowledges after restoration', async () => {
  const { options, operationId, state } = await preparedUpdate()
  let helperReady = false
  options.update.commit = async () => { if (!helperReady) throw new Error('helper commit failed') }
  const host = await createControlledRestartHost({ ...options, operationId })
  host.register(20, 'window', () => {})
  await expect(host.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('helper commit failed')
  expect(await host.shutdownIntent()).toBe('update')
  // A Sidecar commit enables Quit cleanup. Native uncertainty must retain preservation.
  expect(state.commits).toBe(0)
  helperReady = true
  await host.handle(20, 'get_restart_workspace', {})
  expect(await host.shutdownIntent()).toBe('quit')
  expect(state.commits).toBe(1)
})

it('does not replace the app when owned Sidecar exit cannot be verified after detach', async () => {
  const root = await fixtureRoot()
  let detached = false
  let replaced = false
  const host = await createControlledRestartHost({
    root, operationId: null, intent: 'update',
    inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
    replace: async () => { throw new Error('plain restart is forbidden') },
    backend: {
      prepare: async () => {}, cancel: async () => {}, commit: async () => {},
      detach: async () => { detached = true },
      stopForUpdate: async () => {
        expect(detached).toBe(true)
        throw new Error('Owned Sidecar exit was not observed')
      },
    },
    update: {
      preflight: async identity => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
      prepare: async () => {},
      cancel: async () => {}, commit: async () => {},
      replace: async () => { replaced = true },
      readiness: async target => ({ operationId: target.operationId, controller, images, reconciled: true }),
    },
  })
  await expect(capture(host)).rejects.toThrow('Owned Sidecar exit was not observed')
  expect(replaced).toBe(false)
  expect(await host.shutdownIntent()).toBe('update')
})

it.each(['exit', 'signal-only'] as const)('arms replacement only after the owned child exits: %s', async outcome => {
  const root = await fixtureRoot()
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: {}, stdio: 'ignore' })
  const childExited = once(child, 'exit')
  const owned = asChildProcessLike(child)
  const exit = new UpdateSidecarExit(owned)
  let replaced = false
  let detached = false
  try {
    const host = await createControlledRestartHost({
      root, operationId: null, intent: 'update',
      inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
      replace: async () => { throw new Error('plain restart is forbidden') },
      backend: {
        prepare: async () => {}, cancel: async () => {}, commit: async () => {},
        detach: async () => { detached = true },
        stopForUpdate: async () => exit.stop({
          process: owned, config: createSidecarLaunchConfig({ processEnv: {} }),
          stop: async () => {
            expect(detached).toBe(true)
            if (outcome === 'exit') child.kill('SIGTERM')
            return { status: 'already-signaled', signal: null, timedOut: false, error: null }
          },
        }, 200),
      },
      update: {
        preflight: async identity => ({ ...identity, manifestSha256: 'f'.repeat(64), images }),
        prepare: async () => {},
        cancel: async () => {}, commit: async () => {},
        replace: async () => { replaced = true },
        readiness: async target => ({ operationId: target.operationId, controller, images, reconciled: true }),
      },
    })
    if (outcome === 'exit') {
      await capture(host)
      expect(replaced).toBe(true)
    } else {
      await expect(capture(host)).rejects.toThrow('Owned Sidecar exit was not observed')
      expect(child.exitCode).toBeNull()
      expect(child.signalCode).toBeNull()
      expect(replaced).toBe(false)
    }
    expect(await host.shutdownIntent()).toBe('update')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await childExited
  }
})
