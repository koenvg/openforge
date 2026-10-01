import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RestartOperation } from './restartOperation'
import { preflightProductionUpdateLaunch } from './productionUpdateLaunch'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function operation(intent: 'restart' | 'update', withTarget = false) {
  const root = await mkdtemp(join(tmpdir(), 'openforge-update-launch-'))
  roots.push(root)
  const controller = { installation: 'fixture-installation', lifetime: 'fixture-daemon', generation: 1 }
  const identity = createHash('sha256').update(JSON.stringify([root, controller.installation])).digest('hex')
  const record = new RestartOperation(join(root, 'restart-operation.json'), identity)
  const target = withTarget ? { installationId: identity, operationId: 'fixture-operation', manifestSha256: 'a'.repeat(64), images: { app: 'b'.repeat(64), sidecar: 'c'.repeat(64), daemon: 'd'.repeat(64), cli: 'e'.repeat(64), helper: 'f'.repeat(64) } } : undefined
  await record.prepare('fixture-operation', controller, intent, root, target)
  return { root, record }
}

it('refuses pending updates before domain launch without discarding their session handoff', async () => {
  const { root, record } = await operation('update')
  await record.detach('fixture-operation')
  await expect(preflightProductionUpdateLaunch(root)).rejects.toThrow('trusted-release verification')
  expect(await record.shutdownIntent()).toBe('update')
  expect((await record.status())?.phase).toBe('detached')
})

it('does not block ordinary session-preserving restarts', async () => {
  const { root, record } = await operation('restart')
  await record.detach('fixture-operation')
  await expect(preflightProductionUpdateLaunch(root)).resolves.toBeUndefined()
  expect(await record.shutdownIntent()).toBe('restart')
})

it('does not block an explicitly cancelled update on subsequent ordinary launches', async () => {
  const { root, record } = await operation('update')
  await record.cancel('fixture-operation')
  await expect(preflightProductionUpdateLaunch(root)).resolves.toBeUndefined()
})

it('requires matching native launch authority before allowing a pending update to start its Sidecar', async () => {
  const { root, record } = await operation('update', true)
  await record.detach('fixture-operation')
  let authorized = false
  const launch = { operationId: 'fixture-operation', authorize: async () => { authorized = true } }
  await expect(preflightProductionUpdateLaunch(root, { ...launch, operationId: 'foreign' })).rejects.toThrow('verification')
  expect(authorized).toBe(false)
  await expect(preflightProductionUpdateLaunch(root, { ...launch, authorize: async () => { throw new Error('Native process identity refused') } })).rejects.toThrow('Native process identity refused')
  expect(authorized).toBe(false)
  expect(await preflightProductionUpdateLaunch(root, launch)).toEqual((await record.status())?.updateTarget)
  expect(authorized).toBe(true)
  expect((await record.status())?.phase).toBe('detached')
})
