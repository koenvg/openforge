// Applies the isolated experiment patch, runs native-owner tests, records evidence.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const revision = '4ae9f1a2de5484de3d6a13fe03676b8853b9c41c'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.env.GHOSTTY_FORK_ROOT ?? 'artifacts/terminal-presentation/native-ghostty-fork')
const source = join(root, 'upstream')
const patch = join(here, 'host-snapshot.patch')
const full = process.argv.includes('--full')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
function git(...args) {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message)
  return result.stdout.trim()
}
if (git('rev-parse', 'HEAD') !== revision) throw new Error('Run prepare.mjs for the pinned upstream revision first')
const alreadyApplied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: source }).status === 0
if (!alreadyApplied) {
  if (git('status', '--porcelain')) throw new Error('Refusing to patch a dirty checkout that does not already contain this patch')
  git('apply', '--check', patch)
  git('apply', patch)
}
const patchFiles = [...readFileSync(patch, 'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort()
const actualFiles = [...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean).sort()
if (JSON.stringify(patchFiles) !== JSON.stringify(actualFiles)) throw new Error('Unexpected files changed in the experimental checkout')
const zigVersion = spawnSync('zig', ['version'], { encoding: 'utf8' }).stdout?.trim()
if (zigVersion !== '0.16.0') throw new Error('Requires Zig 0.16.0')
mkdirSync(root, { recursive: true })
const checks = []
function check(name, command, args, timeout = 1_200_000) {
  console.log(`Running ${name}`)
  const start = Date.now()
  const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', detached: true, timeout, maxBuffer: 16 * 1024 * 1024 })
  if (result.error?.code === 'ETIMEDOUT' && result.pid) {
    // Stop only this check's process group, including Zig's build/test children.
    try { process.kill(-result.pid, 'SIGTERM') } catch {}
  }
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(join(root, `${name}.log`), output)
  const entry = {
    name, command: [command, ...args], exitCode: result.status,
    error: result.error?.message ?? null, wallMs: Date.now() - start,
    summary: output.match(/^Build Summary: .+$/m)?.[0] ?? null,
    log: `${name}.log`, logSha256: sha256(output),
  }
  checks.push(entry)
  console.log(JSON.stringify(entry))
  if (result.status !== 0) console.error(output.slice(-3000))
  return result.status === 0
}
const common = ['-Demit-macos-app=false', '-Demit-xcframework=false', '-Drenderer=opengl', '--system', join(root, 'packages'), '--summary', 'all']
const formatted = check('format', 'zig', ['fmt', '--check', ...patchFiles.filter((path) => path.endsWith('.zig'))], 30_000)
const focused = check('hosted-tests', 'zig', ['build', 'test', '-Dtest-filter=hosted:', ...common])
if (full && formatted && focused) check('full-tests', 'zig', ['build', 'test', ...common])
const report = {
  revision, zigVersion, platform: process.platform, arch: process.arch,
  patchSha256: sha256(readFileSync(patch)),
  sourceHashes: Object.fromEntries(patchFiles.map((path) => [path, sha256(readFileSync(join(source, path)))])),
  experimentTests: [...readFileSync(join(source, 'src/termio/hosted_tests.zig'), 'utf8').matchAll(/^test "(.+)"/gm)].map((match) => match[1]),
  checks,
  scope: 'Native Termio owner and parser, headless app wakeup, no Surface or renderer instance',
  notTested: ['C ABI attachment', 'Electron integration', 'Metal or OpenGL frames', 'presented-output watermark', 'inline-image checkpoint restoration', 'GUI detach/reattach', 'PTY or IPC latency'],
  fullSuiteRequested: full,
}
writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Evidence: ${join(root, 'report.json')}`)
if (checks.some((entry) => entry.exitCode !== 0)) process.exitCode = 1
