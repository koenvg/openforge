import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { packageRuntimeRelease } from './runtime-release.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it.each([['arm64', 'aarch64'], ['x86_64', 'x86_64']])('packages a self-contained %s release with artifact integrity metadata', async (architecture, manifestArch) => {
  const root = await mkdtemp(join(tmpdir(), 'of-release-'))
  roots.push(root)
  const daemon = join(root, 'daemon')
  await writeFile(daemon, 'daemon', { mode: 0o755 })
  const assets = join(root, 'cli')
  await mkdir(assets)
  await writeFile(join(assets, 'hook.js'), 'hook')
  const output = join(root, 'runtime')
  await packageRuntimeRelease({ daemonPath: daemon, cliAssetsPath: assets, outputPath: output, architecture })
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  expect(manifest).toEqual({
    format: 1, architecture: manifestArch, protocol: 5, stateFormat: 1,
    files: [
      { path: 'openforge-cli/hook.js', sha256: '0648298b48be031996277ae472115a46e7964d2ac3882e61b84351f3c3f8a547', executable: false },
      { path: 'openforge-session-daemon', sha256: 'f77b12a53ece5f6b7050800bbdbf8cc5ebe87f1b1387cf739f243e43e2ce886b', executable: true },
    ],
  })
  expect(await readFile(join(output, 'openforge-cli/hook.js'), 'utf8')).toBe('hook')
})
