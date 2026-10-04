import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { checkEnvironment, here, manifest, packages, repo, root, sha256, source, verifySource } from './common.mjs'

if (process.versions.bun) throw new Error('Run this script with node, not Bun')
if (process.argv.slice(2).some(arg => arg !== '--full')) throw new Error('Usage: node run.mjs [--full]')
checkEnvironment()
verifySource()
const headers = process.env.NODE_INCLUDE_DIR ?? resolve(dirname(process.execPath), '../include/node')
if (!existsSync(join(headers, 'node_api.h'))) throw new Error('Set NODE_INCLUDE_DIR to the Node N-API headers directory')
const backendSource = join(homedir(), '.cache/openforge/ghostty', manifest.revision)
if (!existsSync(backendSource)) throw new Error('First run node scripts/prepare-ghostty-vt.mjs to prepare the production-pinned codec')
const env = {
  ...process.env,
  GHOSTTY_OPENFORGE_ROOT: root,
  GHOSTTY_SOURCE_DIR: backendSource,
  GHOSTTY_ZIG_SYSTEM_DIR: join(homedir(), '.cache/openforge/ghostty', `zig-system-${manifest.revision}`),
}
delete env.ELECTRON_RUN_AS_NODE
const report = {
  revision: manifest.revision,
  scope: 'Native prerequisites and Electron bridge only; no OpenForge session attachment, pixel proof, or performance claim',
  checks: [],
  sourceHashes: manifest.sourceHashes,
  harnessHashes: Object.fromEntries(['addon.mm', 'NativeView.h', 'NativeView.mm', 'authority-probe.m', 'electron-probe.cjs', 'prepare.mjs', 'run.mjs', 'common.mjs'].map(name => [name, sha256(readFileSync(join(here, name)))])),
}
function run(name, command, args, cwd = source, options = {}) {
  const log = join(root, `${name}.log`)
  const fd = openSync(log, 'w')
  const start = Date.now()
  let result
  try {
    result = spawnSync(command, args, { cwd, env: { ...env, ...options.env }, detached: true, timeout: options.timeout ?? 1_200_000, killSignal: 'SIGKILL', stdio: ['ignore', fd, fd] })
    if (result.error?.code === 'ETIMEDOUT') {
      try { process.kill(-result.pid, 'SIGKILL') } catch { /* Already exited. */ }
    }
  } finally { closeSync(fd) }
  report.checks.push({ name, command, args, cwd, exitCode: result.status, signal: result.signal, error: result.error?.message, elapsedMs: Date.now() - start, logSha256: sha256(readFileSync(log)) })
  writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${name}: ${result.status === 0 ? 'PASS' : 'FAIL'} (${Date.now() - start} ms)`)
  if (result.status !== 0) throw new Error(`Inspect ${log}`)
}
const frameworks = ['AppKit', 'Foundation', 'Carbon', 'CoreText', 'CoreGraphics', 'CoreVideo', 'Metal', 'QuartzCore', 'IOSurface', 'IOKit', 'Security', 'UniformTypeIdentifiers'].flatMap(name => ['-framework', name])
const library = join(source, 'zig-out/lib/libghostty-hosted.a')
const compile = ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', `-I${join(source, 'include')}`]
const link = [library, ...frameworks, '-lc++', '-lz']
const common = ['-Demit-macos-app=false', '-Demit-xcframework=false', '--system', realpathSync(packages), '--summary', 'all']
const cargo = ['--release', '--locked', '--offline', '--manifest-path', join(repo, 'scripts/experiments/terminal-restoration/native/Cargo.toml')]
run('fixture', 'cargo', ['run', ...cargo, '--bin', 'hosted_snapshot', '--', join(root, 'backend-snapshot.bin')], repo)
run('rust-format', 'cargo', ['fmt', '--manifest-path', cargo.at(-1), '--check'], repo)
run('rust-clippy', 'cargo', ['clippy', ...cargo, '--bin', 'hosted_snapshot', '--', '-D', 'warnings'], repo)
run('format', 'zig', ['fmt', '--check', ...Object.keys(manifest.sourceHashes).filter(path => path.endsWith('.zig'))])
run('hosted-tests', 'zig', ['build', 'test', '-Dtest-filter=hosted:', '-Drenderer=opengl', ...common])
run('native-build', 'zig', ['build', 'experimental-native-lib', '-Dexperimental-runtime-metal=true', '-Drenderer=metal', '-Doptimize=ReleaseFast', ...common])
run('authority-build', 'clang', [...compile, join(here, 'authority-probe.m'), ...link, '-o', join(root, 'authority-probe')])
run('authority', join(root, 'authority-probe'), [])
run('addon-build', 'clang++', ['-std=c++17', ...compile, '-bundle', '-undefined', 'dynamic_lookup', `-I${headers}`, join(here, 'addon.mm'), join(here, 'NativeView.mm'), ...link, '-o', join(root, 'openforge-ghostty.node')])
run('electron', join(repo, 'node_modules/.bin/electron'), [join(here, 'electron-probe.cjs')], repo, { timeout: 15000 })
run('electron-exit-pending', join(repo, 'node_modules/.bin/electron'), [join(here, 'electron-probe.cjs')], repo, { timeout: 15000, env: { GHOSTTY_EXIT_PENDING: '1' } })
if (process.argv.includes('--full')) run('full-tests', 'zig', ['build', 'test', '-Drenderer=opengl', ...common])
console.log(`Evidence: ${join(root, 'report.json')}`)
