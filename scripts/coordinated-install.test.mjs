import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

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

it('refuses source replacement without trusted handoff support and leaves installed resources untouched', async () => {
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
  // No fake probe may fall through to a host-wide process or filesystem command.
  for (const command of ['pnpm', 'pgrep', 'pkill', 'osascript', 'cp', 'rm', 'xattr', 'open', 'sleep']) {
    const path = join(bin, command)
    await writeFile(path, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$INSTALL_TEST_LOG"\nexit 91\n')
    await chmod(path, 0o755)
  }
  const result = await run('/bin/bash', [join(import.meta.dirname, 'install-electron-mac.sh')], {
    ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`,
    OPENFORGE_ELECTRON_INSTALL_DIR: installDir, INSTALL_TEST_LOG: commandLog,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('trusted-release verification')
  expect(result.stderr).toContain('No app, CLI, or session was changed')
  expect(await readFile(commandLog, 'utf8')).toBe('')
  expect(await readFile(join(installed, 'identity'), 'utf8')).toBe('current-app')
  expect(await readFile(cli, 'utf8')).toBe('current-cli')
  expect(await readFile(join(retained, 'daemon'), 'utf8')).toBe('live-daemon-asset')
})
