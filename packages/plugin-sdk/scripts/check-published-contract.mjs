#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validRange } from 'semver'
import { compile } from 'svelte/compiler'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '..', '..')
const fixturePath = join(packageRoot, 'scripts', 'fixtures', 'current-authoring-contract.ts')
const sourceSchemaPath = join(packageRoot, 'src', 'openforgePackageMetadataSchema.json')
const hostCapabilityReleases = [
  {
    version: '0.2.1',
    capabilities: [
      'commands',
      'events',
      'views',
      'injectionPoints',
      'taskPane',
      'taskStart',
      'settings',
      'background',
      'backend',
      'storage',
      'context',
      'navigation',
      'tasks',
      'projects',
      'fs',
      'shell',
      'notifications',
      'attention',
      'system.openUrl',
      'system.writeClipboardText',
      'config',
      'projectConfig',
      'browserSurfaces',
    ],
  },
  {
    version: '0.2.4',
    capabilities: ['appEnablement', 'customSidebarNavigation'],
  },
  {
    version: '0.2.5',
    capabilities: ['reviewUI'],
  },
]

function fail(message) {
  throw new Error(message)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
  })
  if (result.error) fail(`${command} failed to start: ${result.error.message}`)
  if (result.status !== 0) {
    fail([
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result
}

function resolvePackedLocalImport(importerPath, specifier) {
  const unresolvedPath = resolve(dirname(importerPath), specifier)
  const candidates = [
    unresolvedPath,
    `${unresolvedPath}.js`,
    `${unresolvedPath}.mjs`,
    `${unresolvedPath}.svelte`,
    join(unresolvedPath, 'index.js'),
  ]
  const resolvedPath = candidates.find(existsSync)
  if (!resolvedPath) fail(`Packed Svelte dependency is missing: ${specifier} imported by ${importerPath}`)
  return resolvedPath
}

function compilePackedSvelteTree(entryPath, visited = new Set()) {
  if (visited.has(entryPath)) return
  visited.add(entryPath)

  const source = readFileSync(entryPath, 'utf8')
  compile(source, { filename: entryPath, generate: 'client' })

  const importPattern = /(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(importPattern)) {
    const dependencyPath = resolvePackedLocalImport(entryPath, match[1])
    if (dependencyPath.endsWith('.svelte')) compilePackedSvelteTree(dependencyPath, visited)
  }
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.values(value).flatMap(exportTargets)
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) fail(`Plugin SDK package version is not valid semver: ${version}`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function minimumVersionForCapabilities(schema) {
  const capabilities = schema?.properties?.requires?.items?.enum
  if (!Array.isArray(capabilities) || !capabilities.every(capability => typeof capability === 'string')) {
    fail('Plugin SDK package metadata schema must declare string capabilities.')
  }

  const versionByCapability = new Map()
  for (const release of hostCapabilityReleases) {
    const version = parseVersion(release.version)
    for (const capability of release.capabilities) {
      if (versionByCapability.has(capability)) fail(`Duplicate capability release entry: ${capability}`)
      versionByCapability.set(capability, version)
    }
  }

  const missing = capabilities.filter(capability => !versionByCapability.has(capability))
  const stale = [...versionByCapability.keys()].filter(capability => !capabilities.includes(capability))
  if (missing.length > 0 || stale.length > 0) {
    fail([
      'Host capability release ledger does not match the package metadata schema.',
      missing.length > 0 ? `Record the first SDK version for: ${missing.join(', ')}` : '',
      stale.length > 0 ? `Remove stale capability entries for: ${stale.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }

  return capabilities.reduce((minimum, capability) => {
    const introduced = versionByCapability.get(capability)
    return compareVersions(introduced, minimum) > 0 ? introduced : minimum
  }, [0, 0, 0])
}

function assertVersion(version, minimumContractVersion) {
  const actual = parseVersion(version)
  if (compareVersions(actual, minimumContractVersion) < 0) {
    fail(`Plugin SDK ${version} predates the current host contract; expected at least ${minimumContractVersion.join('.')}.`)
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'openforge-plugin-sdk-contract-'))
try {
  const sourceManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const sourceSchema = JSON.parse(readFileSync(sourceSchemaPath, 'utf8'))
  assertVersion(sourceManifest.version, minimumVersionForCapabilities(sourceSchema))

  run('pnpm', ['pack', '--pack-destination', tempRoot], {
    cwd: packageRoot,
    env: { ...process.env, npm_config_dry_run: 'false' },
  })
  const tarballs = readdirSync(tempRoot).filter(name => name.endsWith('.tgz'))
  if (tarballs.length !== 1) fail(`Expected one packed Plugin SDK tarball, found ${tarballs.length}.`)

  const tarballPath = join(tempRoot, tarballs[0])
  for (const packageManager of ['npm', 'bun']) {
    const consumerRoot = join(tempRoot, `${packageManager}-consumer`)
    mkdirSync(consumerRoot)
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `plugin-sdk-${packageManager}-release-contract`,
      private: true,
      type: 'module',
      dependencies: {
        [sourceManifest.name]: `file:${tarballPath}`,
      },
    }, null, 2)}\n`)

    const installArgs = packageManager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts']
    run(packageManager, installArgs, {
      cwd: consumerRoot,
      env: { ...process.env, npm_config_dry_run: 'false' },
    })
  }
  const consumerRoot = join(tempRoot, 'bun-consumer')
  const installedPackageRoot = join(consumerRoot, 'node_modules', '@openforge-app', 'plugin-sdk')
  const packedManifest = JSON.parse(readFileSync(join(installedPackageRoot, 'package.json'), 'utf8'))
  if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) {
    fail(`Packed identity ${packedManifest.name}@${packedManifest.version} does not match ${sourceManifest.name}@${sourceManifest.version}.`)
  }

  for (const [dependencyName, range] of Object.entries(packedManifest.dependencies ?? {})) {
    if (typeof range !== 'string' || validRange(range) === null) {
      fail(`Packed dependency ${dependencyName} must use a concrete semver range; received ${String(range)}.`)
    }
  }

  const targets = [packedManifest.main, packedManifest.types, ...exportTargets(packedManifest.exports)]
  for (const target of new Set(targets.filter(value => typeof value === 'string'))) {
    const targetPath = join(installedPackageRoot, target.replace(/^\.\//, ''))
    if (!existsSync(targetPath)) fail(`Packed export target is missing: ${target}`)
  }

  const packedSvelteExports = new Set(
    exportTargets(packedManifest.exports).filter(target => typeof target === 'string' && target.endsWith('.svelte')),
  )
  for (const target of packedSvelteExports) {
    compilePackedSvelteTree(join(installedPackageRoot, target.replace(/^\.\//, '')))
  }

  writeFileSync(join(consumerRoot, 'esm-resolution.mjs'), `const testing = await import('@openforge-app/plugin-sdk/testing')
const vite = await import('@openforge-app/plugin-sdk/vite')
if (typeof testing.createMockOpenForgeApi !== 'function') {
  throw new Error('Installed Plugin SDK testing entry point did not expose createMockOpenForgeApi.')
}
if (typeof vite.createOpenForgePluginSdkSourceAliases !== 'function') {
  throw new Error('Installed Plugin SDK Vite entry point did not expose createOpenForgePluginSdkSourceAliases.')
}
`)
  run(process.execPath, ['./esm-resolution.mjs'], { cwd: consumerRoot })

  writeFileSync(join(consumerRoot, 'authoring-contract.ts'), readFileSync(fixturePath, 'utf8'))
  writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
    files: ['./authoring-contract.ts'],
  }, null, 2)}\n`)

  run('pnpm', ['exec', 'tsc', '--project', join(consumerRoot, 'tsconfig.json')], { cwd: consumerRoot })
  console.log(`Validated packed ${packedManifest.name}@${packedManifest.version} with clean npm and Bun consumers.`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
