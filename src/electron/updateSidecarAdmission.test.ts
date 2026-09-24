// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { asChildProcessLike, createSidecarLaunchConfig, startSidecarReadiness } from './sidecar.js'

it.each(['approve', 'refuse'] as const)('waits for native child admission before readiness: %s', async decision => {
  const root = await mkdtemp(join(tmpdir(), 'of-sidecar-admission-'))
  const marker = join(root, 'domain-started')
  const config = createSidecarLaunchConfig({ executablePath: process.execPath, processEnv: {}, port: 17423 })
  config.args = ['--input-type=module', '-e', `
    import { writeFileSync } from 'node:fs';
    if (!process.argv.includes('--openforge-update-startup')) process.exit(2);
    let input = '';
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      if (!input) process.exit(3);
      writeFileSync(${JSON.stringify(marker)}, input);
      setInterval(() => {}, 1000);
    });
  `, '--']
  let child: ChildProcess | undefined
  let exited = Promise.resolve()
  let release!: (value: string) => void
  let refuse!: (error: Error) => void
  const admission = new Promise<string>((resolve, reject) => { release = resolve; refuse = reject })
  void admission.catch(() => {})
  let started!: () => void
  const awaitingAdmission = new Promise<void>(resolve => { started = resolve })
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'complete' } }) }))
  const pending = startSidecarReadiness(config, {
    spawn: (command, args, options) => {
      child = spawn(command, [...args], options)
      exited = new Promise<void>(resolve => child!.once('exit', () => resolve()))
      return asChildProcessLike(child)
    },
    authorizeStartup: async () => { started(); return admission },
    fetch, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    createEventStream: () => ({ start: async () => {}, ready: async () => {}, stop: () => {} }),
  })
  // Observe rejection immediately so a failed admission never becomes unhandled.
  const result = pending.then(value => ({ value }), error => ({ error }))
  try {
    await Promise.race([awaitingAdmission, result.then(() => { throw new Error('Sidecar readiness bypassed native admission') })])
    expect(fetch).not.toHaveBeenCalled()
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    if (decision === 'refuse') {
      refuse(new Error('native registration refused'))
      expect(await result).toMatchObject({ error: { message: 'native registration refused' } })
      expect(fetch).not.toHaveBeenCalled()
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      release('native-admission')
      const outcome = await result
      expect('value' in outcome).toBe(true)
      expect(fetch).toHaveBeenCalled()
      await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe('native-admission'))
    }
  } finally {
    refuse(new Error('fixture closed'))
    child?.kill('SIGKILL')
    await exited
    await result
    await rm(root, { recursive: true, force: true })
  }
})

it('does not run Quit cleanup when an admitted update Sidecar fails event readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'of-update-readiness-failure-'))
  const marker = join(root, 'quit-cleanup')
  const config = createSidecarLaunchConfig({ executablePath: process.execPath, processEnv: {}, port: 17423 })
  config.args = ['--input-type=module', '-e', `
    import { writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, 'Quit ran'); process.exit(0); });
    process.stdin.resume();
    process.stdin.on('end', () => process.stdout.write('ready'));
    setTimeout(() => process.exit(9), 60_000);
  `, '--']
  let child: ChildProcess | undefined
  let exited = Promise.resolve()
  let ready = Promise.resolve()
  try {
    await expect(startSidecarReadiness(config, {
      spawn: (command, args, options) => {
        child = spawn(command, [...args], options)
        exited = new Promise<void>(resolve => child!.once('exit', () => resolve()))
        ready = new Promise<void>(resolve => child!.stdout!.once('data', () => resolve()))
        return asChildProcessLike(child)
      },
      authorizeStartup: async () => 'native-admission',
      fetch: async () => {
        await ready
        return { ok: true, json: async () => ({ status: 'ok', events: { available: true }, startupResume: { phase: 'complete' } }) }
      },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      createEventStream: () => ({ start: async () => {}, ready: async () => { throw new Error('event stream unavailable') }, stop: () => {} }),
    })).rejects.toThrow('event stream unavailable')
    await exited
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await rm(root, { recursive: true, force: true })
  }
})
