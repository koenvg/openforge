// @vitest-environment node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { asChildProcessLike } from './sidecar'
import { UpdateSidecarExit } from './updateSidecarExit'

it('retires an owned update Sidecar without running its Quit signal cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-update-retirement-'))
  const marker = join(root, 'quit-cleanup')
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => {
      require('node:fs').writeFileSync(process.argv[1], 'Quit ran');
      process.exit(0);
    });
    process.stdout.write('ready');
    setTimeout(() => process.exit(9), 60_000);
  `, marker], { env: {}, stdio: ['ignore', 'pipe', 'ignore'] })
  const exited = once(child, 'exit')
  const owned = asChildProcessLike(child)
  const exit = new UpdateSidecarExit(owned)
  try {
    await once(child.stdout!, 'data')
    await exit.retire(owned)
    expect(child.signalCode).toBe('SIGKILL')
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    // Repeated retirement uses the recorded exit rather than signalling a PID again.
    await exit.retire(owned)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses a changed child handle before signalling it', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })
  const exited = once(child, 'exit')
  const otherExited = once(other, 'exit')
  try {
    const owned = asChildProcessLike(child)
    const exit = new UpdateSidecarExit(owned)
    await expect(exit.wait(asChildProcessLike(other))).rejects.toThrow('ownership changed')
    await expect(exit.wait(owned, 10)).rejects.toThrow('exit was not observed')
    expect(child.killed).toBe(false)
    await expect(exit.retire(asChildProcessLike(other))).rejects.toThrow('ownership changed')
    expect(other.killed).toBe(false)
  } finally {
    child.kill('SIGKILL')
    other.kill('SIGKILL')
    await Promise.all([exited, otherExited])
  }
})
