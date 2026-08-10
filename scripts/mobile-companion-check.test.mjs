import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')
const mobileScript = join(repoRoot, 'scripts/mobile-companion')

function runScript(script, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(script, ['check'], {
      cwd,
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
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
  ])
  await Promise.all([
    chmod(fixtureScript, 0o755),
    chmod(flutter, 0o755),
    chmod(dart, 0o755),
  ])

  return { root, fixtureScript, flutter, log, lockfile }
}

describe('Mobile Companion check command', () => {
  it('verifies the committed dependency resolution without changing the lockfile', async () => {
    const fixture = await createCheckFixture()
    try {
      const before = await readFile(fixture.lockfile, 'utf8')

      const result = await runScript(fixture.fixtureScript, fixture.root, {
        FLUTTER_BIN: fixture.flutter,
        FAKE_FLUTTER_LOG: fixture.log,
      })

      expect(result.status, result.stderr).toBe(0)
      expect(await readFile(fixture.lockfile, 'utf8')).toBe(before)
      expect(await readFile(fixture.log, 'utf8')).toBe(
        'pub get --enforce-lockfile\nanalyze\ntest\n',
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
