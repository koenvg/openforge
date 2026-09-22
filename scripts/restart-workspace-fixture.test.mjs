import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { cleanupRestartFixture } from './restart-workspace-fixture.mjs'

const roots = []
const writers = []
afterEach(async () => {
  for (const writer of writers.splice(0)) {
    if (writer.exitCode === null) {
      if (!writer.stdin.writableEnded) writer.stdin.end('\n')
      await once(writer, 'exit')
    }
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('keeps isolated daemon and runtime data until a writer finishes after the socket disappears', async () => {
  const daemonRoot = await mkdtemp(join(tmpdir(), 'openforge-restart-daemon-'))
  const runRoot = await mkdtemp(join(tmpdir(), 'openforge-desktop-test-'))
  roots.push(daemonRoot, runRoot)
  await writeFile(join(runRoot, 'sentinel'), 'runtime')
  const runtime = join(daemonRoot, 'session-v1')
  await mkdir(runtime)
  await writeFile(join(runtime, 'daemon.lock'), '')
  await writeFile(join(runtime, 'control.sock'), '')
  const writer = spawn('python3', ['-u', '-c', `
import fcntl, pathlib, sys
runtime = pathlib.Path(sys.argv[1])
with (runtime / 'daemon.lock').open() as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    print('READY', flush=True)
    sys.stdin.readline()
    (runtime / 'restart.json').write_text('committed')
`, runtime], { stdio: ['pipe', 'pipe', 'pipe'] })
  writers.push(writer)
  await new Promise((resolve, reject) => {
    writer.once('error', reject)
    writer.stdout.once('data', chunk => chunk.toString().includes('READY') ? resolve() : reject(new Error('writer not ready')))
  })
  await rm(join(runtime, 'control.sock'))

  let settled = false
  const cleanup = cleanupRestartFixture({ daemonRoot, runRoot, stopOwnedWriters: async () => {} })
    .finally(() => { settled = true })
  try {
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(settled).toBe(false)
    writer.stdin.end('\n')
    await once(writer, 'exit')
    expect(await readFile(join(runtime, 'restart.json'), 'utf8')).toBe('committed')
    await cleanup
    expect(await readFile(join(runtime, 'restart.json')).catch(error => error.code)).toBe('ENOENT')
    expect(await readFile(join(runRoot, 'sentinel')).catch(error => error.code)).toBe('ENOENT')
  } finally {
    if (!writer.stdin.writableEnded) writer.stdin.end('\n')
    await cleanup.catch(() => {})
  }
})

it('leaves both fixture roots intact while owned Electron and lifecycle shutdown are pending', async () => {
  const daemonRoot = await mkdtemp(join(tmpdir(), 'openforge-restart-daemon-'))
  const runRoot = await mkdtemp(join(tmpdir(), 'openforge-desktop-test-'))
  roots.push(daemonRoot, runRoot)
  await writeFile(join(runRoot, 'sentinel'), 'runtime')
  let finishShutdown
  const stopped = new Promise(resolve => { finishShutdown = resolve })
  let enteredShutdown
  const entered = new Promise(resolve => { enteredShutdown = resolve })
  const cleanup = cleanupRestartFixture({
    daemonRoot, runRoot,
    stopOwnedWriters: async () => { enteredShutdown(); await stopped },
  })
  try {
    await entered
    expect(await readFile(join(runRoot, 'sentinel'), 'utf8')).toBe('runtime')
    finishShutdown()
    await cleanup
    expect(await readFile(join(runRoot, 'sentinel')).catch(error => error.code)).toBe('ENOENT')
  } finally {
    finishShutdown()
    await cleanup.catch(() => {})
  }
})
