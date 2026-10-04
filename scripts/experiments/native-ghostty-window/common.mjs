import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const repo = resolve(here, '../../..')
export const root = resolve(process.env.GHOSTTY_WINDOW_ROOT ?? join(repo, 'artifacts/terminal-presentation/native-ghostty-window'))
export const source = join(root, 'upstream')
export const baseline = join(here, '../native-ghostty-fork/host-snapshot.patch')
export const patch = join(here, 'hosted-window.patch')
export const manifest = JSON.parse(readFileSync(join(here, 'source-manifest.json'), 'utf8'))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim()
export function checkEnvironment() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This window experiment requires macOS ARM64')
  if (!root.startsWith(join(repo, 'artifacts') + sep)) throw new Error('Keep the experimental checkout under this repository’s artifacts directory')
  if (existsSync(source)) {
    const resolved = realpathSync(source)
    const protectedSource = join(repo, 'artifacts/terminal-presentation/native-ghostty-fork/upstream')
    if (!resolved.startsWith(realpathSync(join(repo, 'artifacts')) + sep) || (existsSync(protectedSource) && resolved === realpathSync(protectedSource))) {
      throw new Error('Use a separate checkout, not the headless fork or an external source cache')
    }
  }
  if (execFileSync('zig', ['version'], { encoding: 'utf8' }).trim() !== '0.16.0') throw new Error('Requires Zig 0.16.0')
  if (sha256(readFileSync(baseline)) !== manifest.baselinePatchSha256 || sha256(readFileSync(patch)) !== manifest.windowPatchSha256) {
    throw new Error('Retained patches do not match source-manifest.json')
  }
}
export function matchesSources(hashes) {
  const actual = [...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean).sort()
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(hashes).sort())) return false
  return Object.entries(hashes).every(([path, hash]) => existsSync(join(source, path)) && sha256(readFileSync(join(source, path))) === hash)
}
export function verifySource() {
  if (git('rev-parse', 'HEAD') !== manifest.revision || !matchesSources(manifest.sourceHashes)) {
    throw new Error('Experimental source differs from the pinned patches. Preserve local edits; do not reset it blindly.')
  }
}
