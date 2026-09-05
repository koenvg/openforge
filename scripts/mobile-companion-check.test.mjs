import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')
const mobileScript = join(repoRoot, 'scripts/mobile-companion')

async function runScript(script, cwd, env, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    // These are POSIX shell fixtures. A separate group lets cancellation also kill
    // tools launched by the script, including ones that keep its pipes open.
    const child = spawn(script, ['check'], { cwd, env, detached: true })
    let stdout = ''
    let stderr = ''
    let failure
    const cancel = () => {
      failure = signal.reason
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') failure = error
        }
      }
    }
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => { failure ??= error })
    child.once('close', (status) => {
      signal.removeEventListener('abort', cancel)
      // Wait for close before settling so callers can safely remove fixtures.
      if (failure) reject(failure)
      else resolve({ status, stdout, stderr })
    })
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

async function createCheckFixture() {
  const root = await mkdtemp(join(tmpdir(), 'openforge-mobile-check-'))
  const scriptsDirectory = join(root, 'scripts')
  const appDirectory = join(root, 'apps/mobile_companion')
  const toolsDirectory = join(root, 'tools')
  await Promise.all([
    mkdir(scriptsDirectory, { recursive: true }),
    mkdir(join(appDirectory, 'lib'), { recursive: true }),
    mkdir(join(appDirectory, 'test'), { recursive: true }),
    mkdir(toolsDirectory, { recursive: true }),
  ])

  const fixtureScript = join(scriptsDirectory, 'mobile-companion')
  const flutter = join(toolsDirectory, 'flutter')
  const dart = join(toolsDirectory, 'dart')
  const node = join(toolsDirectory, 'node')
  const log = join(root, 'flutter.log')
  const lockfile = join(appDirectory, 'pubspec.lock')

  await Promise.all([
    copyFile(mobileScript, fixtureScript),
    writeFile(join(scriptsDirectory, 'check-companion-dart-contract.mjs'), ''),
    writeFile(lockfile, 'committed dependency resolution\n'),
    writeFile(join(appDirectory, 'lib/main.dart'), 'void main() {}\n'),
    writeFile(flutter, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_FLUTTER_LOG"
if [[ "$*" == "pub get" ]]; then
  printf 'unexpected dependency resolution\\n' > pubspec.lock
fi
`),
    writeFile(dart, '#!/usr/bin/env bash\nexit 0\n'),
    // Contract generation has its own suite. Do not boot Node for an empty file
    // while the full Vitest run is competing for subprocess startup resources.
    writeFile(node, '#!/bin/sh\nprintf "%s\\n" "$*" > "$FAKE_NODE_LOG"\n'),
  ])
  await Promise.all([
    chmod(fixtureScript, 0o755),
    chmod(flutter, 0o755),
    chmod(dart, 0o755),
    chmod(node, 0o755),
  ])

  const nodeLog = join(root, 'node.log')
  const env = {
    PATH: `${toolsDirectory}:/usr/bin:/bin`,
    FLUTTER_BIN: flutter,
    DART_BIN: dart,
    FAKE_FLUTTER_LOG: log,
    FAKE_NODE_LOG: nodeLog,
  }
  return { root, fixtureScript, log, lockfile, nodeLog, env }
}

describe('runScript', () => {
  it('reports spawn errors without an unhandled error event', async ({ signal }) => {
    await expect(runScript('/missing/openforge-script', repoRoot, {}, signal))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves nonzero exit status and output', async ({ signal, onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-script-failure-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const script = join(root, 'fail')
    await writeFile(script, '#!/bin/sh\necho output\necho diagnostic >&2\nexit 7\n', { mode: 0o755 })
    await expect(runScript(script, root, {}, signal)).resolves.toEqual({
      status: 7, stdout: 'output\n', stderr: 'diagnostic\n',
    })
  })

  it('kills the shell and descendants before rejecting cancellation', async ({ signal, onTestFinished }) => {
    // Share the five-second test budget, reserving a second for final cleanup.
    const pollDeadline = performance.now() + 4_000
    const pollOptions = () => ({ timeout: Math.max(1, pollDeadline - performance.now()) })
    const root = await mkdtemp(join(tmpdir(), 'openforge-script-cancel-'))
    const controller = new AbortController()
    let execution
    onTestFinished(async () => {
      controller.abort()
      await execution?.catch(() => {})
      await rm(root, { recursive: true, force: true })
    })
    const script = join(root, 'hang')
    const pids = join(root, 'pids')
    await writeFile(script, `#!/bin/sh
echo $$ > pids
/bin/sh -c 'trap "" TERM; echo $$ >> pids; while :; do /bin/sleep 1; done' &
wait
`, { mode: 0o755 })
    execution = runScript(script, root, {}, AbortSignal.any([signal, controller.signal]))
    // Attach a rejection handler before waiting for the readiness handshake.
    const outcome = execution.catch((error) => error)
    let childPids
    await expect.poll(async () => {
      childPids = (await readFile(pids, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(Number)
      return childPids.length
    }, pollOptions()).toBe(2)
    const reason = new Error('test canceled')
    controller.abort(reason)
    expect(await outcome).toBe(reason)
    for (const pid of childPids) {
      await expect.poll(() => {
        try { process.kill(pid, 0); return false }
        catch (error) { if (error.code === 'ESRCH') return true; throw error }
      }, pollOptions()).toBe(true)
    }
  })

  it('rejects cancellation before spawning', async () => {
    const controller = new AbortController()
    const reason = new Error('test canceled')
    controller.abort(reason)
    await expect(runScript('/bin/echo', repoRoot, {}, controller.signal)).rejects.toBe(reason)
  })
})

describe('Mobile Companion check command', () => {
  it('verifies the committed dependency resolution without changing the lockfile', async ({ signal, onTestFinished }) => {
    const fixture = await createCheckFixture()
    let execution
    onTestFinished(async () => {
      await execution?.catch(() => {})
      await rm(fixture.root, { recursive: true, force: true })
    })
    // A developer's tool overrides and shell/Node startup hooks must not leak in.
    vi.stubEnv('DART_BIN', '/missing/dart')
    vi.stubEnv('BASH_ENV', join(fixture.root, 'poison.bash'))
    vi.stubEnv('NODE_OPTIONS', '--require=/missing/startup.cjs')
    onTestFinished(() => vi.unstubAllEnvs())
    await writeFile(join(fixture.root, 'poison.bash'), 'exit 99\n')
    const before = await readFile(fixture.lockfile, 'utf8')
    execution = runScript(fixture.fixtureScript, fixture.root, fixture.env, signal)
    const result = await execution

    expect(result.status, result.stderr).toBe(0)
    expect(await readFile(fixture.lockfile, 'utf8')).toBe(before)
    expect(await readFile(fixture.log, 'utf8')).toBe(
      'pub get --enforce-lockfile\nanalyze\ntest\n',
    )
    expect(await readFile(fixture.nodeLog, 'utf8')).toBe(
      `${join(fixture.root, 'scripts/check-companion-dart-contract.mjs')}\n`,
    )
  })
})
