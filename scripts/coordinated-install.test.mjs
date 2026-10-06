import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { coldRecoveryHelper } from './cold-install/recovery.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.once('error', reject)
    child.once('close', status => resolve({ status, stdout, stderr }))
  })
}

it('uses cold-install preflight by default and leaves installed resources untouched on unsupported platforms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-install-refusal-'))
  roots.push(root)
  const home = join(root, 'home')
  const installDir = join(root, 'Applications')
  const installed = join(installDir, 'Open Forge.app')
  const bin = join(root, 'bin')
  const cli = join(home, '.openforge/bin/openforge')
  const retained = join(home, 'runtime/releases/current')
  const commandLog = join(root, 'commands')
  await Promise.all([installed, bin, join(home, '.openforge/bin'), retained].map(path => mkdir(path, { recursive: true })))
  await writeFile(join(installed, 'identity'), 'current-app')
  await writeFile(cli, 'current-cli')
  await writeFile(join(retained, 'daemon'), 'live-daemon-asset')
  await writeFile(commandLog, '')
  const platformFixture = join(root, 'platform.mjs')
  await writeFile(platformFixture, `Object.defineProperty(process, 'platform', { value: 'win32' })`)
  // No fake probe may fall through to a host-wide process or filesystem command.
  for (const command of ['pnpm', 'pgrep', 'pkill', 'osascript', 'cp', 'rm', 'xattr', 'open', 'sleep']) {
    const path = join(bin, command)
    await writeFile(path, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$INSTALL_TEST_LOG"\nexit 91\n')
    await chmod(path, 0o755)
  }
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh')], {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`,
    OPENFORGE_ELECTRON_INSTALL_DIR: installDir, INSTALL_TEST_LOG: commandLog,
    NODE_OPTIONS: `--import=${pathToFileURL(platformFixture).href}`,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Cold installation supports macOS arm64 only')
  expect(await readFile(commandLog, 'utf8')).toBe('')
  expect(await readFile(join(installed, 'identity'), 'utf8')).toBe('current-app')
  expect(await readFile(cli, 'utf8')).toBe('current-cli')
  expect(await readFile(join(retained, 'daemon'), 'utf8')).toBe('live-daemon-asset')
})

it('offers cold-install help by default without enabling live updates', async () => {
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh'), '--help'], process.env)
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('--skip-build')
  expect(result.stdout).toContain('local build approval')
  expect(result.stdout).toContain('running OpenForge')
  expect(result.stdout).toContain('Live updates remain disabled')
  expect(result.stdout).toContain('does not preserve sessions')
})

it('keeps --cold as an alias for default cold installation', async () => {
  const script = join(import.meta.dirname, 'install-electron-mac.sh')
  const result = await run('/bin/bash', [script, '--cold', '--help'], process.env)
  const defaultResult = await run('/bin/bash', [script, '--help'], process.env)
  expect(result.status).toBe(0)
  expect(result.stdout).toBe(defaultResult.stdout)
})

it.each([{ flags: [] }, { flags: ['--cold'] }])('rejects caller-supplied approval with flags $flags before touching an installation', async ({ flags }) => {
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh'), ...flags, '--approved'], process.env)
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Unknown cold-install option')
})

it.runIf(process.platform !== 'darwin' || process.arch !== 'arm64')('refuses cold recovery on unsupported platforms', async () => {
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh'), '--recover'], process.env)
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Cold installation supports macOS arm64 only')
})

it('refuses forged recovery state before returning a retained helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge cold recovery '))
  roots.push(root)
  const profile = join(root, 'profile')
  const native = join(profile, 'updates/native')
  const installDir = join(root, 'Applications')
  const platformFixture = join(root, 'platform.mjs')
  await mkdir(native, { recursive: true, mode: 0o700 })
  await mkdir(installDir)
  await writeFile(platformFixture, `
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
  `)
  await writeFile(join(native, 'journal.key'), Buffer.alloc(32, 42), { mode: 0o600 })
  await writeFile(join(native, 'current.json'), JSON.stringify({ payload: '{}', mac: '00'.repeat(32) }), { mode: 0o600 })
  await expect(coldRecoveryHelper(profile, join(root, 'Open Forge.app')))
    .rejects.toThrow('Invalid cold recovery authentication')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh'), '--recover', '--profile', profile, '--install-dir', installDir], {
    ...env, HOME: root, NODE_OPTIONS: `--import=${pathToFileURL(platformFixture).href}`,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Invalid cold recovery authentication')
})
