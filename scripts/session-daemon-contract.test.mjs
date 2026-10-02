import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('Session Daemon contract launcher', () => {
  it('builds the gated startup fixture explicitly without selecting a feature daemon for ordinary contracts', () => {
    const root = mkdtempSync(join(tmpdir(), 'of-contract-launcher-'))
    try {
      const bin = join(root, 'bin')
      mkdirSync(bin)
      const log = join(root, 'cargo.log')
      writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CARGO_CONTRACT_LOG"\n', { mode: 0o700 })
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./session-daemon-contract.mjs', import.meta.url))], {
        env: { ...env, PATH: `${bin}:${env.PATH ?? ''}`, CARGO_TARGET_DIR: join(root, 'target'), CARGO_CONTRACT_LOG: log },
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      const commands = readFileSync(log, 'utf8').trim().split('\n')
      const ordinaryBuild = commands.findIndex(command => command.startsWith('build ') && command.endsWith('crates/session-daemon/Cargo.toml'))
      expect(ordinaryBuild).toBeGreaterThanOrEqual(0)
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        const fixtureBuild = commands.findIndex(command => command.endsWith('--features replacement-fixtures --bin openforge-session-daemon-fixture-startup'))
        expect(fixtureBuild).toBeGreaterThanOrEqual(0)
        expect(fixtureBuild).toBeLessThan(ordinaryBuild)
      }
      expect(commands[ordinaryBuild]).not.toContain('--features')
      expect(commands.at(-1)).toContain('--test session_daemon_sidecar -- --ignored')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
