#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

const WRAPPER_REVISION = 'de9fd9b0fa4ab53faebd3d489f4c74fe0ec832ec'
const GHOSTTY_REVISION = '22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018'
const ZIG_VERSION = '0.16.0'
const GHOSTTY_REPOSITORY = 'https://github.com/ghostty-org/ghostty.git'
const cacheRoot = process.env.OPENFORGE_GHOSTTY_CACHE_DIR
  ?? join(homedir(), '.cache', 'openforge', 'ghostty')
const sourceDir = join(cacheRoot, GHOSTTY_REVISION)
const systemDir = join(cacheRoot, `zig-system-${GHOSTTY_REVISION}`)
const fetchCacheDir = join(cacheRoot, `zig-fetch-${GHOSTTY_REVISION}`)
const repositoryRoot = join(import.meta.dirname, '..')

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim()
}

function requireZig() {
  const actual = run('zig', ['version'])
  if (actual !== ZIG_VERSION) {
    throw new Error(`Zig ${ZIG_VERSION} is required, found ${actual}`)
  }
}

function prepareGhosttySource() {
  mkdirSync(cacheRoot, { recursive: true })
  const sourceWasCloned = !existsSync(join(sourceDir, '.git'))
  if (sourceWasCloned) {
    rmSync(sourceDir, { recursive: true, force: true })
    run('git', ['clone', '--filter=blob:none', '--no-checkout', GHOSTTY_REPOSITORY, sourceDir])
  }

  let actual = run('git', ['rev-parse', 'HEAD'], { cwd: sourceDir })
  const revisionChanged = actual !== GHOSTTY_REVISION
  if (revisionChanged) {
    run('git', ['fetch', '--filter=blob:none', 'origin', GHOSTTY_REVISION], { cwd: sourceDir })
  }
  if (sourceWasCloned || revisionChanged) {
    run('git', ['checkout', '--detach', GHOSTTY_REVISION], { cwd: sourceDir })
    actual = run('git', ['rev-parse', 'HEAD'], { cwd: sourceDir })
  }
  if (actual !== GHOSTTY_REVISION) {
    throw new Error(`Ghostty revision mismatch: expected ${GHOSTTY_REVISION}, found ${actual}`)
  }
}

function zonFiles(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'zig-cache') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'build.zig.zon') files.push(path)
    }
  }
  visit(root)
  return files
}

function remoteDependencies(root) {
  const dependencies = new Map()
  const pattern = /\.url\s*=\s*"([^"]+)"\s*,\s*\.hash\s*=\s*"([^"]+)"/g
  for (const file of zonFiles(root)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const [, url, hash] = match
      if (!dependencies.has(hash)) dependencies.set(hash, url)
    }
  }
  return dependencies
}

function downloadableUrl(url) {
  if (!url.startsWith('git+https://github.com/')) return url
  const repository = new URL(url.slice('git+'.length))
  const revision = repository.hash.slice(1)
  if (!revision) throw new Error(`Git package URL has no revision: ${url}`)
  repository.hash = ''
  repository.pathname = repository.pathname.replace(/\.git$/, '')
  return `${repository.toString().replace(/\/$/, '')}/archive/${revision}.tar.gz`
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

export function tarExtractionArgs(archive, destination, { platform = process.platform } = {}) {
  const localArchive = platform === 'win32' ? archive.replaceAll('\\', '/') : archive
  const localDestination = platform === 'win32' ? destination.replaceAll('\\', '/') : destination
  return [
    ...(platform === 'win32' ? ['--force-local'] : []),
    '-xf',
    localArchive,
    '-C',
    localDestination,
    '--strip-components=1',
  ]
}

export function extractPackageArchive(
  archive,
  destination,
  { platform = process.platform, runCommand = run } = {},
) {
  const args = tarExtractionArgs(archive, destination, { platform })
  try {
    runCommand('tar', args)
  } catch (error) {
    if (platform !== 'win32') throw error
    // Git for Windows may see an archive symlink before its target. The first pass
    // extracts the target, and the second resolves the symlink through MSYS.
    runCommand('tar', args)
  }
}

async function preparePackage(hash, url) {
  const destination = join(systemDir, hash)
  if (existsSync(destination)) return false

  const temporaryDir = mkdtempSync(join(tmpdir(), 'openforge-ghostty-'))
  try {
    const downloadUrl = downloadableUrl(url)
    const archive = join(temporaryDir, basename(new URL(downloadUrl).pathname) || 'package.tar')
    await download(downloadUrl, archive)
    const actualHash = run(
      'zig',
      ['fetch', '--global-cache-dir', fetchCacheDir, archive],
      { cwd: sourceDir },
    )
    if (actualHash !== hash) {
      throw new Error(`Zig package identity mismatch for ${url}: expected ${hash}, found ${actualHash}`)
    }
    mkdirSync(destination, { recursive: true })
    try {
      extractPackageArchive(archive, destination)
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      throw error
    }
    return true
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true })
  }
}

async function prepareZigPackages() {
  mkdirSync(systemDir, { recursive: true })
  mkdirSync(fetchCacheDir, { recursive: true })
  const pending = new Map(remoteDependencies(sourceDir))
  const processed = new Set()
  while (pending.size > 0) {
    const [hash, url] = pending.entries().next().value
    pending.delete(hash)
    if (processed.has(hash)) continue
    await preparePackage(hash, url)
    processed.add(hash)
    const packageDir = join(systemDir, hash)
    if (existsSync(packageDir)) {
      for (const [nestedHash, nestedUrl] of remoteDependencies(packageDir)) {
        if (!processed.has(nestedHash)) pending.set(nestedHash, nestedUrl)
      }
    }
  }
  return processed.size
}

function prepareRustDependencies() {
  const lockfile = readFileSync(join(repositoryRoot, 'src-tauri', 'Cargo.lock'), 'utf8')
  const lockedSource = `git+https://github.com/Uzaaft/libghostty-rs.git?rev=${WRAPPER_REVISION}#${WRAPPER_REVISION}`
  if (!lockfile.includes(lockedSource)) {
    throw new Error(`Cargo.lock does not pin libghostty-vt to ${WRAPPER_REVISION}`)
  }
  const manifestArgs = [
    'fetch',
    '--locked',
    '--manifest-path',
    join(repositoryRoot, 'src-tauri', 'Cargo.toml'),
  ]
  const options = {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GHOSTTY_SOURCE_DIR: sourceDir,
      GHOSTTY_ZIG_SYSTEM_DIR: systemDir,
    },
  }
  try {
    run('cargo', [...manifestArgs, '--offline'], {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    run('cargo', manifestArgs, options)
  }
}

export async function prepareGhosttyVt({ logger = null } = {}) {
  requireZig()
  prepareGhosttySource()
  const packageCount = await prepareZigPackages()
  prepareRustDependencies()

  logger?.(`libghostty-vt wrapper revision: ${WRAPPER_REVISION}`)
  logger?.(`Ghostty source revision: ${GHOSTTY_REVISION}`)
  logger?.(`Prepared Zig packages: ${packageCount}`)
  logger?.(`GHOSTTY_SOURCE_DIR=${sourceDir}`)
  logger?.(`GHOSTTY_ZIG_SYSTEM_DIR=${systemDir}`)

  return {
    GHOSTTY_SOURCE_DIR: sourceDir,
    GHOSTTY_ZIG_SYSTEM_DIR: systemDir,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareGhosttyVt({ logger: message => console.log(message) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
