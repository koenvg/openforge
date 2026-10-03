// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FixtureProcess } from './fixtures/updateFixtureProcess.js'

it('bounds a stalled fixture, observes owned exit and retains stdout and stderr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-fixture-process-'))
  const fixture = new FixtureProcess(spawn(process.execPath, ['-e', 'console.log("ready"); console.error("diagnostic"); setInterval(() => {}, 1000)'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  }), root, 'stalled')
  try {
    await fixture.waitForOutput('ready\n', 5_000)
    await expect(fixture.waitForOutput('never', 40)).rejects.toThrow(root)
    await expect(fixture.waitForExit(40)).rejects.toThrow('exit timed out')
    await fixture.stop()
    await fixture.waitForExit(40)
    const log = await readFile(join(root, 'stalled.log'), 'utf8')
    expect(log).toContain('ready')
    expect(log).toContain('diagnostic')
    expect(log).toContain('signal=SIGKILL')
  } finally { await fixture.stop(); await rm(root, { recursive: true, force: true }) }
})

it('does not hang on spawn failure or early exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-fixture-process-'))
  const fixture = new FixtureProcess(spawn(join(root, 'missing'), [], { stdio: ['pipe', 'pipe', 'pipe'] }), root, 'missing')
  try {
    await expect(fixture.waitForOutput('ready', 5_000)).rejects.toThrow('did not report')
    await fixture.stop()
    await fixture.waitForExit(40)
  } finally { await fixture.stop(); await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('retires a stopped cold Sidecar and its spawned daemon, but not an existing live owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-fixture-group-'))
  const live = new FixtureProcess(spawn(process.execPath, ['-e', 'console.log("live-ready"); setInterval(() => {}, 1000)'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  }), root, 'live')
  const sidecar = new FixtureProcess(spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log('owned-daemon:' + daemon.pid);
    console.error('cold fixture diagnostic');
    setInterval(() => {}, 1000);
  `], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }), root, 'cold', { ownedProcessGroup: true })
  try {
    await live.waitForOutput('live-ready\n', 5_000)
    await sidecar.waitForOutput('owned-daemon:', 5_000)
    sidecar.child.kill('SIGSTOP')
    await expect(sidecar.waitForExit(40)).rejects.toThrow('exit timed out')
    await sidecar.stop()
    // The group was created from our own spawn handle, not runtime inventory.
    expect(() => process.kill(-sidecar.child.pid!, 0)).toThrow()
    expect(live.child.exitCode).toBeNull()
    expect(live.child.kill(0)).toBe(true)
    expect(await readFile(join(root, 'cold.log'), 'utf8')).toContain('cold fixture diagnostic')
  } finally {
    // Also clean up the known group when running this regression against the old owner.
    try { process.kill(-sidecar.child.pid!, 'SIGKILL') } catch {}
    await sidecar.stop()
    await live.stop()
    await rm(root, { recursive: true, force: true })
  }
})
