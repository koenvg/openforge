import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const launcher = fileURLToPath(new URL('./session-daemon-contract.mjs', import.meta.url))
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const hasStartupFixture = process.platform === 'darwin' && process.arch === 'arm64'
const daemonName = process.platform === 'win32' ? 'openforge-session-daemon.exe' : 'openforge-session-daemon'
const startupName = process.platform === 'win32' ? 'openforge-session-daemon-fixture-startup.exe' : 'openforge-session-daemon-fixture-startup'

function withLauncher(run, { targetRelative = false, buildTarget = '', explicitDaemon = false, missing = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'of-contract-launcher-'))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const log = join(root, 'cargo.log')
    writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nprintf "%s\\0%s\\0%s\\0" "$*" "$OPENFORGE_TEST_DAEMON" "$OPENFORGE_TEST_STARTUP_DAEMON" >> "$CARGO_CONTRACT_LOG"\n', { mode: 0o700 })
    const target = join(root, 'private target')
    const daemon = explicitDaemon ? join(root, 'selected daemon', daemonName) : join(target, buildTarget, 'debug', daemonName)
    const startupDaemon = join(target, buildTarget, 'debug', startupName)
    for (const [kind, artifact] of [['daemon', daemon], ['startup', startupDaemon]]) {
      if (kind === missing) continue
      mkdirSync(dirname(artifact), { recursive: true })
      writeFileSync(artifact, '', { mode: 0o700 })
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_') && !key.startsWith('CARGO_')))
    const result = spawnSync(process.execPath, [launcher], {
      // Artifact resolution must use the launcher's Cargo working directory, not this caller's.
      cwd: root,
      env: {
        ...env,
        PATH: `${bin}:${env.PATH ?? ''}`,
        CARGO_TARGET_DIR: targetRelative ? relative(repoRoot, target) : target,
        CARGO_BUILD_TARGET: buildTarget,
        CARGO_CONTRACT_LOG: log,
        ...(explicitDaemon ? { OPENFORGE_TEST_DAEMON: daemon } : {}),
      },
      encoding: 'utf8',
    })
    const fields = readFileSync(log, 'utf8').split('\0')
    const commands = []
    for (let i = 0; i < fields.length - 1; i += 3) {
      commands.push({ args: fields[i], daemon: fields[i + 1], startupDaemon: fields[i + 2] })
    }
    run({ result, commands, daemon, startupDaemon })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function expectSelectedArtifacts({ result, commands, daemon, startupDaemon }) {
  expect(result.status, result.stderr).toBe(0)
  const contracts = commands.filter(({ args }) => args.startsWith('test ') && args.includes('--ignored'))
  expect(contracts.length).toBeGreaterThan(0)
  for (const contract of contracts) {
    expect(contract.daemon).toBe(daemon)
    if (hasStartupFixture) expect(contract.startupDaemon).toBe(startupDaemon)
    expect(contract.args).not.toMatch(/--test-threads/)
  }
  expect(contracts.at(-1).args).toContain('--test session_daemon_sidecar')
}

describe('Session Daemon contract launcher', () => {
  it('selects the private target artifacts without changing ordinary build features or parallelism', () => {
    withLauncher(context => {
      expectSelectedArtifacts(context)
      const commands = context.commands.map(({ args }) => args)
      const ordinaryBuild = commands.findIndex(command => command.startsWith('build ') && command.endsWith('crates/session-daemon/Cargo.toml'))
      expect(ordinaryBuild).toBeGreaterThanOrEqual(0)
      if (hasStartupFixture) {
        const fixtureBuild = commands.findIndex(command => command.endsWith('--features replacement-fixtures --bin openforge-session-daemon-fixture-startup'))
        expect(fixtureBuild).toBeGreaterThanOrEqual(0)
        expect(fixtureBuild).toBeLessThan(ordinaryBuild)
      }
      expect(commands[ordinaryBuild]).not.toContain('--features')
    })
  })

  it('resolves a relative private target against the Cargo working directory', () => {
    withLauncher(expectSelectedArtifacts, { targetRelative: true })
  })

  it('selects artifacts inside an explicit Cargo build target', () => {
    withLauncher(expectSelectedArtifacts, { buildTarget: 'aarch64-apple-darwin' })
  })

  it('preserves an explicit daemon selection instead of silently selecting the just-built default', () => {
    withLauncher(expectSelectedArtifacts, { explicitDaemon: true })
  })

  it.each([false, true])('fails before backend contracts when the requested daemon is missing, explicit=%s', explicitDaemon => {
    withLauncher(({ result, commands, daemon }) => {
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(daemon)
      expect(result.stderr).toMatch(/daemon artifact.*missing/i)
      expect(commands.some(({ args }) => args.includes('--ignored'))).toBe(false)
    }, { explicitDaemon, missing: 'daemon' })
  })

  it.skipIf(!hasStartupFixture)('fails clearly when the gated startup artifact is missing', () => {
    withLauncher(({ result, commands, startupDaemon }) => {
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(startupDaemon)
      expect(commands.some(({ args }) => args.includes('--ignored'))).toBe(false)
    }, { missing: 'startup' })
  })
})
