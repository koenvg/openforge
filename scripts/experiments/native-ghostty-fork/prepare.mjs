// Prepares an isolated upstream checkout and verified Zig dependencies.
// Never changes OpenForge's dependency pins or the shared Ghostty source cache.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { remoteDependencies, enqueueDependencies, fetchWithRetry, extractPackageArchive } from '../../prepare-ghostty-vt.mjs'

const revision = '4ae9f1a2de5484de3d6a13fe03676b8853b9c41c'
const root = resolve(process.argv[2] ?? 'artifacts/terminal-presentation/native-ghostty-fork')
const source = join(root, 'upstream')
const packages = join(root, 'packages')
const fetchCache = join(root, 'fetch-cache')
const sharedPackages = join(homedir(), '.cache/openforge/ghostty/zig-system-22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018')
function run(command, args, cwd = source) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
mkdirSync(source, { recursive: true })
if (!existsSync(join(source, '.git'))) {
  run('git', ['init', '-q'])
  run('git', ['remote', 'add', 'origin', 'https://github.com/ghostty-org/ghostty.git'])
  run('git', ['fetch', '--depth=1', 'origin', revision])
  run('git', ['checkout', '-q', '-b', 'experiment/openforge-host-snapshot', 'FETCH_HEAD'])
}
if (run('git', ['rev-parse', 'HEAD']) !== revision) throw new Error('unexpected upstream checkout revision')
if (run('zig', ['version']) !== '0.16.0') throw new Error('requires Zig 0.16.0')
mkdirSync(packages, { recursive: true })
mkdirSync(fetchCache, { recursive: true })
const pending = new Map(remoteDependencies(source, { includeBundledPackages: true }))
const processed = new Set()
while (pending.size) {
  const [hash, url] = pending.entries().next().value
  pending.delete(hash)
  if (processed.has(hash)) continue
  const destination = join(packages, hash)
  if (!existsSync(destination)) {
    if (existsSync(join(sharedPackages, hash))) {
      symlinkSync(join(sharedPackages, hash), destination, 'dir')
    } else {
      const temporary = mkdtempSync(join(tmpdir(), 'ghostty-host-package-'))
      try {
        let downloadUrl = url
        if (url.startsWith('git+https://github.com/')) {
          const parsed = new URL(url.slice(4))
          downloadUrl = `${parsed.origin}${parsed.pathname.replace(/\.git$/, '')}/archive/${parsed.hash.slice(1)}.tar.gz`
        }
        const response = await fetchWithRetry(downloadUrl)
        const archive = join(temporary, basename(new URL(downloadUrl).pathname))
        writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
        const actual = run('zig', ['fetch', '--global-cache-dir', fetchCache, archive])
        if (actual !== hash) throw new Error(`dependency identity mismatch: ${url}`)
        mkdirSync(destination, { recursive: true })
        try { extractPackageArchive(archive, destination) } catch (error) {
          rmSync(destination, { recursive: true, force: true })
          throw error
        }
        console.log(`prepared ${hash}`)
      } finally { rmSync(temporary, { recursive: true, force: true }) }
    }
  }
  processed.add(hash)
  enqueueDependencies(pending, remoteDependencies(destination), processed)
}
console.log(JSON.stringify({ revision, source, packages, packageCount: processed.size }))
