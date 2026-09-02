#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validRange } from 'semver'
import { compile } from 'svelte/compiler'
import { svelte as sveltePlugin } from '@sveltejs/vite-plugin-svelte'
import { build as viteBuild } from 'vite'
import { assertPublicUiDeclarationsHideBitsUi } from './public-ui-declaration-contract.mjs'
import { OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS } from '../src/publicUiExports.mjs'

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
  {
    version: '0.3.0',
    capabilities: ['viewReplacements'],
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

async function buildPackedExternalPluginFixture(consumerRoot, installedPackageRoot) {
  const fixtureRoot = join(consumerRoot, 'packed-external-plugin')
  const outputRoot = join(fixtureRoot, 'dist')
  mkdirSync(fixtureRoot)
  writeFileSync(join(fixtureRoot, 'entry.js'), `import { mount } from 'svelte'
import App from './App.svelte'

mount(App, { target: document.body })
`)
  writeFileSync(join(fixtureRoot, 'App.svelte'), `<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'

  let showModal = $state(true)
  let selected = $state('open')
  let tab = $state('details')
  const options = [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]
  const tabs = [{ value: 'details', label: 'Details' }, { value: 'activity', label: 'Activity' }]
  const menuItems = [{ value: 'edit', label: 'Edit' }, { value: 'delete', label: 'Delete' }]
</script>

{#if showModal}
  <Modal ariaLabel="Packed plugin modal" onClose={() => showModal = false}>Packed modal content</Modal>
{/if}
<Select label="Status" {options} bind:value={selected} />
<Tabs label="Plugin sections" {tabs} bind:value={tab} />
<AnchoredMenu label="Plugin actions" items={menuItems}>
  {#snippet trigger()}Actions{/snippet}
</AnchoredMenu>
<Tooltip label="Plugin help" content="Shared host runtime tooltip">
  {#snippet trigger()}Help{/snippet}
</Tooltip>
`)

  const packedViteEntry = join(installedPackageRoot, 'dist', 'vite.js')
  const { openforgePluginViteExternals } = await import(pathToFileURL(packedViteEntry).href)
  await viteBuild({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [sveltePlugin()],
    build: {
      emptyOutDir: true,
      outDir: outputRoot,
      lib: { entry: join(fixtureRoot, 'entry.js'), formats: ['es'], fileName: 'external-plugin' },
      rolldownOptions: { external: openforgePluginViteExternals },
    },
  })

  const bundle = readFileSync(join(outputRoot, 'external-plugin.js'), 'utf8')
  const imports = [...bundle.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
  const svelteImports = imports.filter(specifier => specifier === 'svelte' || specifier.startsWith('svelte/'))
  if (svelteImports.length === 0) {
    fail('Packed external plugin bundle did not preserve host-shared Svelte imports.')
  }
  const unexpectedSvelteImports = svelteImports.filter(specifier => !openforgePluginViteExternals(specifier))
  if (unexpectedSvelteImports.length > 0) {
    fail(`Packed external plugin emitted unshared Svelte imports: ${unexpectedSvelteImports.join(', ')}`)
  }
  if (imports.includes('bits-ui') || imports.some(specifier => specifier.startsWith('bits-ui/'))) {
    fail('Packed external plugin exposed the private Bits UI implementation dependency.')
  }
  if (/effect_orphan|HYDRATION_ERROR/.test(bundle)) {
    fail('Packed external plugin bundled Svelte runtime internals instead of sharing the host runtime.')
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

  const packedReadmePath = join(installedPackageRoot, 'README.md')
  if (!existsSync(packedReadmePath)) fail('Packed Plugin SDK README.md is missing.')
  const sourceReadme = readFileSync(join(packageRoot, 'README.md'), 'utf8')
  const packedReadme = readFileSync(packedReadmePath, 'utf8')
  if (packedReadme !== sourceReadme) fail('Packed Plugin SDK README.md does not match the package README.')

  assertPublicUiDeclarationsHideBitsUi(
    OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map(({ componentName, distPath }) => ({
      componentName,
      source: readFileSync(join(installedPackageRoot, distPath.replace(/^\.\//, '')), 'utf8'),
    })),
  )
  await buildPackedExternalPluginFixture(consumerRoot, installedPackageRoot)

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

  const executableExportSpecifiers = Object.entries(packedManifest.exports)
    .flatMap(([exportName, target]) => {
      const executableTarget = typeof target === 'string' ? target : target?.default
      if (typeof executableTarget !== 'string' || !executableTarget.endsWith('.js')) return []
      return [`${sourceManifest.name}${exportName === '.' ? '' : exportName.slice(1)}`]
    })
  const packedSvelteExportSpecifiers = Object.entries(packedManifest.exports)
    .flatMap(([exportName, target]) => {
      const svelteTarget = typeof target === 'string' ? target : target?.default
      if (typeof svelteTarget !== 'string' || !svelteTarget.endsWith('.svelte')) return []
      return [`${sourceManifest.name}${exportName.slice(1)}`]
    })
  writeFileSync(join(consumerRoot, 'esm-resolution.mjs'), `const exportsBySpecifier = new Map(await Promise.all(
    ${JSON.stringify(executableExportSpecifiers)}.map(async specifier => [specifier, await import(specifier)]),
))
for (const specifier of ${JSON.stringify(packedSvelteExportSpecifiers)}) {
  const resolved = import.meta.resolve(specifier)
  if (!resolved.startsWith('file:')) {
    throw new Error(\`Installed Plugin SDK Svelte export did not resolve to a file: \${specifier}\`)
  }
}
const testing = exportsBySpecifier.get('@openforge-app/plugin-sdk/testing')
const vite = exportsBySpecifier.get('@openforge-app/plugin-sdk/vite')
if (typeof testing?.createMockOpenForgeApi !== 'function') {
  throw new Error('Installed Plugin SDK testing entry point did not expose createMockOpenForgeApi.')
}
if (typeof vite?.createOpenForgePluginSdkSourceAliases !== 'function') {
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
