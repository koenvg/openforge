import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const repo = resolve(here, '../../..')
export const root = resolve(process.env.GHOSTTY_OPENFORGE_ROOT ?? join(repo, 'artifacts/terminal-presentation/native-ghostty-openforge'))
export const source = join(root, 'pinned-upstream')
export const packages = join(root, 'packages-pinned')
export const patch = join(here, 'hosted-openforge.patch')
export const manifest = JSON.parse(readFileSync(join(here, 'source-manifest.json'), 'utf8'))
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim()
export function checkEnvironment() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Requires macOS ARM64')
  if (!root.startsWith(join(repo, 'artifacts') + sep)) throw new Error('Keep this checkout under repository artifacts')
  if (existsSync(root) && !realpathSync(root).startsWith(realpathSync(join(repo, 'artifacts')) + sep)) throw new Error('Artifact root escapes repository')
  if (existsSync(source) && !realpathSync(source).startsWith(realpathSync(root) + sep)) throw new Error('Use an isolated native checkout')
  if (execFileSync('zig', ['version'], { encoding: 'utf8' }).trim() !== '0.16.0') throw new Error('Requires Zig 0.16.0')
  if (sha256(readFileSync(patch)) !== manifest.patchSha256) throw new Error('Patch hash mismatch')
}
export function verifySource() {
  if (git('rev-parse', 'HEAD') !== manifest.revision) throw new Error('Unexpected Ghostty revision')
  const actual = [...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean).sort()
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.sourceHashes).sort())) throw new Error('Unexpected native source edits; preserve them before preparing again')
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) {
    if (!existsSync(join(source, path)) || sha256(readFileSync(join(source, path))) !== hash) throw new Error(`Native source hash mismatch: ${path}`)
  }
}
