import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { remoteDependencies, enqueueDependencies, fetchWithRetry, extractPackageArchive } from '../../prepare-ghostty-vt.mjs'
import { checkEnvironment, git, manifest, packages, patch, repo, root, source, verifySource } from './common.mjs'

checkEnvironment()
mkdirSync(source, { recursive: true })
if (!existsSync(join(source, '.git'))) {
  git('init', '-q')
  git('remote', 'add', 'origin', 'https://github.com/ghostty-org/ghostty.git')
  git('fetch', '--depth=1', 'origin', manifest.revision)
  git('checkout', '-q', '--detach', 'FETCH_HEAD')
}
if (git('rev-parse', 'HEAD') !== manifest.revision) throw new Error('Unexpected base revision')
if (git('status', '--porcelain') === '') {
  git('apply', '--check', patch)
  git('apply', patch)
}
verifySource()
mkdirSync(packages, { recursive: true })
const caches = [
  join(homedir(), '.cache/openforge/ghostty', `zig-system-${manifest.revision}`),
  join(repo, 'artifacts/terminal-presentation/native-ghostty-fork/packages'),
]
const pending = new Map(remoteDependencies(source, { includeBundledPackages: true }))
const processed = new Set()
while (pending.size) {
  const [hash, url] = pending.entries().next().value
  pending.delete(hash)
  if (processed.has(hash)) continue
  const destination = join(packages, hash)
  if (!existsSync(destination)) {
    const cached = caches.map(cache => join(cache, hash)).find(existsSync)
    if (cached) {
      // Materialize generator packages: relative executable paths fail through symlinks.
      cpSync(cached, destination, { recursive: true, dereference: true })
    } else {
      const temporary = mkdtempSync(join(tmpdir(), 'openforge-native-dependency-'))
      try {
        let download = url
        if (url.startsWith('git+https://github.com/')) {
          const parsed = new URL(url.slice(4))
          download = `${parsed.origin}${parsed.pathname.replace(/\.git$/, '')}/archive/${parsed.hash.slice(1)}.tar.gz`
        }
        const archive = join(temporary, basename(new URL(download).pathname))
        writeFileSync(archive, Buffer.from(await (await fetchWithRetry(download)).arrayBuffer()))
        const actual = execFileSync('zig', ['fetch', '--global-cache-dir', join(root, 'fetch-cache'), archive], { encoding: 'utf8' }).trim()
        if (actual !== hash) throw new Error(`Dependency hash mismatch: ${url}`)
        mkdirSync(destination, { recursive: true })
        try { extractPackageArchive(archive, destination) } catch (error) {
          rmSync(destination, { recursive: true, force: true })
          throw error
        }
      } finally { rmSync(temporary, { recursive: true, force: true }) }
    }
  }
  processed.add(hash)
  enqueueDependencies(pending, remoteDependencies(destination), processed)
}
console.log(JSON.stringify({ revision: manifest.revision, source, packageCount: processed.size }))
