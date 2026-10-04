// Build and launch the isolated AppKit demo, or run its bounded verification.
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { here, root, source, manifest, sha256, checkEnvironment, verifySource } from './common.mjs'

const flags = new Set(process.argv.slice(2))
if ([...flags].some(flag => !['--build-only', '--test', '--full'].includes(flag))) throw new Error('Usage: run.mjs [--build-only | --test | --full]')
const test = flags.has('--test') || flags.has('--full')
checkEnvironment()
verifySource()
mkdirSync(root, { recursive: true })
const checks = []
function check(name, command, args, timeout = 1_200_000) {
  console.log(`Running ${name}`)
  const start = Date.now()
  const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', detached: true, timeout, maxBuffer: 16 * 1024 * 1024 })
  if (result.error?.code === 'ETIMEDOUT' && result.pid) { try { process.kill(-result.pid, 'SIGTERM') } catch {} }
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(join(root, `${name}.log`), output)
  const entry = {
    name, command: [command, ...args], exitCode: result.status, signal: result.signal,
    error: result.error?.message ?? null, wallMs: Date.now() - start,
    summary: output.match(/^Build Summary: .+$/m)?.[0] ?? null,
    log: `${name}.log`, logSha256: sha256(output),
  }
  checks.push(entry)
  console.log(JSON.stringify(entry))
  if (result.status !== 0) throw new Error(`${name} failed: ${output.slice(-3000)}`)
  return output
}
const frameworks = ['AppKit', 'Foundation', 'Carbon', 'CoreText', 'CoreGraphics', 'CoreVideo', 'Metal', 'QuartzCore', 'IOSurface', 'IOKit', 'Security', 'UniformTypeIdentifiers']
const nativeLink = [join(source, 'zig-out/lib/libghostty-hosted.a'), ...frameworks.flatMap(name => ['-framework', name]), '-lc++', '-lz']
// uucode's generator requires the physical path, not a packages-directory symlink.
const packages = realpathSync(join(root, 'packages'))
const common = ['-Demit-macos-app=false', '-Demit-xcframework=false', '--system', packages, '--summary', 'all']
const binary = join(root, 'native-ghostty-window')
let failure
try {
  check('format', 'zig', ['fmt', '--check', ...Object.keys(manifest.sourceHashes).filter(path => path.endsWith('.zig'))], 30_000)
  check('metal-preflight-build', 'clang', ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', join(here, 'metal-preflight.m'), '-framework', 'Foundation', '-framework', 'Metal', '-o', join(root, 'metal-preflight')], 60_000)
  check('metal-preflight', join(root, 'metal-preflight'), [join(source, 'src/renderer/shaders/shaders.metal')], 60_000)
  check('native-build', 'zig', ['build', 'experimental-native-lib', '-Dexperimental-runtime-metal=true', '-Drenderer=metal', '-Doptimize=ReleaseFast', ...common])
  check('host-api-link', 'clang', ['-Wall', '-Wextra', '-Werror', '-I', join(source, 'include'), join(here, 'host-contract-probe.c'), ...nativeLink, '-o', join(root, 'host-contract-probe')], 60_000)
  check('host-api-probe', join(root, 'host-contract-probe'), [], 10_000)
  check('demo-build', 'clang', ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-I', join(source, 'include'), join(here, 'Demo.m'), ...nativeLink, '-o', binary], 60_000)
  if (test) {
    const output = check('window-self-test', binary, ['--self-test'], 90_000)
    if (!output.includes('"event":"self-test-passed"')) throw new Error('Window test exited without its success marker')
    check('hosted-tests', 'zig', ['build', 'test', '-Dtest-filter=hosted:', '-Drenderer=opengl', ...common])
    if (flags.has('--full')) check('full-tests', 'zig', ['build', 'test', '-Drenderer=opengl', ...common])
  }
} catch (error) {
  failure = String(error)
} finally {
  const harnessFiles = ['common.mjs', 'prepare.mjs', 'run.mjs', 'Demo.m', 'metal-preflight.m', 'host-contract-probe.c']
  writeFileSync(join(root, 'report.json'), `${JSON.stringify({
    ...manifest, platform: process.platform, arch: process.arch, checks, failure: failure ?? null,
    harnessHashes: Object.fromEntries(harnessFiles.map(path => [path, sha256(readFileSync(join(here, path)))])),
    scope: 'Isolated native Surface/C ABI and AppKit fixture window, runtime-compiled Metal shaders',
    notEstablished: ['pixel correctness or first-correct-frame latency', 'presented-output watermark', 'OpenForge session/PTY/IPC attachment', 'image checkpoint restoration', 'IME/clipboard/accessibility conformance', 'production reply authority or transport-drain barriers'],
    fullSuiteRequested: flags.has('--full'),
  }, null, 2)}\n`)
}
if (failure) throw new Error(failure)
console.log(`Evidence: ${join(root, 'report.json')}`)
if (!test && !flags.has('--build-only')) {
  console.log('Opening fixture window. No shell or OpenForge session. Close the window or press Cmd-Q to exit.')
  const fd = openSync(join(root, 'window.log'), 'w')
  try {
    const result = spawnSync(binary, [], { cwd: root, stdio: ['inherit', fd, fd] })
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Window exited ${result.status}, signal ${result.signal}; see window.log`)
  } finally { closeSync(fd) }
}
