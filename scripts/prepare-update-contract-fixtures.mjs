// Opt-in contract preparation. No installed app or developer runtime is used.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'

const root = mkdtempSync(join(tmpdir(), 'of-update-contract-build-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
const log = join(root, 'preparation.log')
const fd = openSync(log, 'w', 0o600)
function cargo(manifestName, args, names) {
  const manifest = execFileSync(process.execPath, ['scripts/rust-sidecar-layout.mjs', manifestName], { env, encoding: 'utf8', timeout: 10_000 }).trim()
  const output = join(root, `${manifestName}.jsonl`)
  const out = openSync(output, 'w', 0o600)
  try {
    execFileSync('cargo', ['build', '--locked', '--manifest-path', manifest, ...args, '--message-format=json'], {
      env, stdio: ['ignore', out, fd], timeout: 600_000, killSignal: 'SIGKILL',
    })
  } finally { closeSync(out) }
  const artifacts = readFileSync(output, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  return Object.fromEntries(names.map(name => {
    const artifact = artifacts.find(row => row.reason === 'compiler-artifact' && row.target.name === name && row.executable)
    if (!artifact) throw new Error(`Missing fixture artifact: ${name}`)
    return [name, artifact.executable]
  }))
}
try {
  const artifacts = {
    ...cargo('update-helper-manifest-path', ['--release', '--features', 'test-fixtures', '--examples', '--bins'], [
      'install-transaction-fixture', 'install-transaction-fixture-v2', 'source-sidecar-fixture', 'openforge-update-helper',
    ]),
    ...cargo('session-daemon-manifest-path', ['--features', 'replacement-fixtures', '--bins'], [
      'openforge-session-daemon', 'openforge-session-daemon-fixture-v2',
    ]),
  }
  for (const [name, entry] of [['source', 'updateHelperHost'], ['target', 'updateTargetHost']]) {
    await build({ configFile: false, publicDir: false, logLevel: 'silent',
      // Fixture-only diagnostics. Production does not interpret stderr as protocol.
      plugins: [{ name: 'retain-helper-diagnostics', enforce: 'pre', transform(code, id) {
        if (!id.endsWith('/updateHelperProcess.ts')) return null
        const original = 'this.child.stderr.resume()'
        if (!code.includes(original)) throw new Error('Helper diagnostic capture no longer matches')
        return code.replace(original, 'this.child.stderr.on("data", chunk => process.stderr.write(chunk)); this.child.stderr.resume()')
      } }],
      build: {
        ssr: `src/electron/fixtures/${entry}.ts`, outDir: join(root, name),
        rollupOptions: { external: ['electron'], output: { entryFileNames: 'host.mjs' } },
      },
    })
  }
  await build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
    ssr: 'src/electron/fixtures/updateBundleCreation.ts', outDir: join(root, 'filesystem'),
    rollupOptions: { output: { entryFileNames: 'worker.mjs' } },
  } })
  const result = { root, artifacts, electronExecutable: createRequire(import.meta.url)('electron'), filesystemWorker: join(root, 'filesystem/worker.mjs'), sourceHost: join(root, 'source/host.mjs'), targetHost: join(root, 'target/host.mjs') }
  writeFileSync(join(root, 'artifacts.json'), JSON.stringify(result), { mode: 0o600 })
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(`Native fixture preparation failed. Diagnostics retained at ${root}`, error)
  process.exitCode = 1
} finally { closeSync(fd) }
