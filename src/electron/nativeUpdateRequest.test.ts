import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createControlledRestartHost } from './controlledRestartHost'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('shares registered workspace capture with a native update request without accepting renderer update intent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-native-update-request-'))
  roots.push(root)
  const controller = { installation: 'private-installation', lifetime: 'private-daemon', generation: 1 }
  const images = { app: 'a'.repeat(64), sidecar: 'b'.repeat(64), daemon: 'c'.repeat(64), cli: 'd'.repeat(64), helper: 'e'.repeat(64) }
  const events: string[] = []
  const host = await createControlledRestartHost({
    root, operationId: null,
    inventory: async () => ({ controller, hasLegacySessions: false, sessions: [] }),
    replace: async () => { throw new Error('Updates must not use ordinary relaunch') },
    backend: {
      prepare: async (_id, intent) => { events.push(`prepare:${intent}`) }, cancel: async () => {},
      detach: async () => { events.push('detach') }, commit: async () => {},
      stopForUpdate: async () => { events.push('sidecar-exited') },
    },
    update: {
      preflight: async identity => { events.push('approved'); return { ...identity, manifestSha256: 'f'.repeat(64), images } },
      prepare: async () => { events.push('helper-prepared') },
      cancel: async () => {}, replace: async () => { events.push('helper-armed') }, commit: async () => {},
      readiness: async target => ({ operationId: target.operationId, images, controller, reconciled: true }),
    },
  })
  host.register(10, 'window', operationId => {
    events.push('capture')
    void host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
  })
  await expect(host.handle(10, 'install_update', { intent: 'update' })).rejects.toThrow('Unknown restart workspace command')
  await expect(host.requestUpdate(99)).rejects.toThrow('Unregistered')
  expect(events).toEqual([])
  await host.requestUpdate(10)
  expect(events).toEqual(['approved', 'helper-prepared', 'prepare:update', 'capture', 'detach', 'sidecar-exited', 'helper-armed'])
  expect(await host.shutdownIntent()).toBe('update')
})
