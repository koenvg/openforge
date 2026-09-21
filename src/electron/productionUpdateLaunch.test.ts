import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RestartOperation } from './restartOperation'
import { preflightProductionUpdateLaunch } from './productionUpdateLaunch'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function operation(intent: 'restart' | 'update') {
  const root = await mkdtemp(join(tmpdir(), 'openforge-update-launch-'))
  roots.push(root)
  const controller = { installation: 'fixture-installation', lifetime: 'fixture-daemon', generation: 1 }
  const identity = createHash('sha256').update(JSON.stringify([root, controller.installation])).digest('hex')
  const record = new RestartOperation(join(root, 'restart-operation.json'), identity)
  await record.prepare('fixture-operation', controller, intent)
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
