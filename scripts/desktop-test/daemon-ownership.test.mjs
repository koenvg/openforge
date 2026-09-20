import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDaemonOwnershipRegistry } from './daemon-ownership.mjs'

const roots = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('reuse mode never reads credentials or stops borrowed processes', async () => {
  const registry = await createDaemonOwnershipRegistry({ mode: 'reuse' })
  expect(await registry.cleanup()).toEqual({ owned: false, resources: [] })
})

it('records detached resources and delegates descendant teardown to the authenticated owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-owned-'))
  roots.push(root)
  const registry = await createDaemonOwnershipRegistry({ mode: 'isolated', runRoot: root })
  const runtime = join(root, 'app-data', 'session-daemon', 'session-v1')
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  await writeFile(join(runtime, 'credentials.json'), JSON.stringify({ installation: 'installation', token: 'a'.repeat(64) }), { mode: 0o600 })
  const commands = []
  const controller = { installation: 'installation', lifetime: 'daemon', generation: 2 }
  const result = await registry.cleanup({
    exchange: async (_runtime, _credentials, command) => {
      commands.push(command)
      if (command.kind === 'connect') return { kind: 'inventory', value: { controller, sessions: [{ pty: { instance: 7 } }] } }
      return { kind: 'done' }
    },
    waitForExit: async () => {},
  })
  expect(commands.map(command => command.kind)).toEqual(['connect', 'terminate', 'shutdownEmpty'])
  expect(commands[1].controller).toEqual(controller)
  expect(result.resources).toContain(join(runtime, 'credentials.json'))
  expect(result.resources).toContain(join(runtime, 'daemon.log'))
  expect(result.resources).toContain(join(runtime, 'control.sock'))
  expect(JSON.stringify(result)).not.toContain('a'.repeat(64))
  expect(await readFile(join(runtime, 'credentials.json'), 'utf8')).toContain('installation')
})

it.each(['invalidRequest', 'outcomeUnknown', 'staleController', 'expired'])(
  'handles shutdown refusal %s without replaying termination or reacquiring ownership', async scenario => {
    const daemonCode = scenario === 'expired' ? 'invalidRequest' : scenario
    const root = await mkdtemp(join(tmpdir(), 'of-drain-'))
    roots.push(root)
    const registry = await createDaemonOwnershipRegistry({ mode: 'isolated', runRoot: root })
    const runtime = join(root, 'app-data', 'session-daemon', 'session-v1')
    await mkdir(runtime, { recursive: true, mode: 0o700 })
    await writeFile(join(runtime, 'credentials.json'), JSON.stringify({ installation: 'installation', token: 'a'.repeat(64) }), { mode: 0o600 })
    const controller = { installation: 'installation', lifetime: 'daemon', generation: 2 }
    const commands = []
    let shutdowns = 0
    let waitedForExit = false
    if (scenario === 'expired') vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(6000)
    const cleanup = registry.cleanup({
      exchange: async (_runtime, _credentials, command) => {
        commands.push(command.kind)
        if (command.kind === 'connect') return { kind: 'inventory', value: { controller, sessions: [{ pty: { instance: 7 } }] } }
        if (command.kind === 'shutdownEmpty' && ++shutdowns <= 2) {
          throw Object.assign(new Error('Daemon refused shutdown'), { daemonCode })
        }
        return { kind: 'done' }
      },
      waitForExit: async () => { waitedForExit = true },
    })
    if (scenario === 'invalidRequest') {
      await expect(cleanup).resolves.toMatchObject({ owned: true })
      expect(commands).toEqual(['connect', 'terminate', 'shutdownEmpty', 'shutdownEmpty', 'shutdownEmpty'])
      expect(waitedForExit).toBe(true)
    } else {
      await expect(cleanup).rejects.toThrow('Daemon refused shutdown')
      expect(commands).toEqual(['connect', 'terminate', 'shutdownEmpty'])
      expect(waitedForExit).toBe(false)
    }
    expect(await readFile(join(runtime, 'credentials.json'), 'utf8')).toContain('installation')
  },
)

it('refuses cleanup after fixture ownership changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-owned-'))
  roots.push(root)
  const registry = await createDaemonOwnershipRegistry({ mode: 'isolated', runRoot: root })
  await writeFile(join(root, 'daemon-fixture-owner.json'), '{}')
  await expect(registry.cleanup()).rejects.toThrow(/ownership changed/)
})
