import { cp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveRustSidecarLayout } from '../rust-sidecar-layout.mjs'
import { assertExists, pathExists } from './file-system.mjs'
import { repoRootFromScript } from './repo-root.mjs'

export const BUILTIN_PLUGIN_CATALOG_FILE = 'builtin-plugins.json'
export const ELECTRON_APP_RUNTIME_DEPENDENCIES = Object.freeze(['es-module-lexer'])
const OPENFORGE_CLI_RUNTIME_ASSET_MANIFEST_FILE = 'runtime-assets.json'

export function validateOpenForgeCliRuntimeAssetManifest(manifest, manifestPath = OPENFORGE_CLI_RUNTIME_ASSET_MANIFEST_FILE) {
  const runtimeFiles = manifest?.runtimeFiles

  if (!Array.isArray(runtimeFiles) || runtimeFiles.length === 0) {
    throw new Error(`OpenForge CLI runtime asset manifest must declare at least one runtime file at ${manifestPath}`)
  }

  const invalidFilename = runtimeFiles.find(filename => (
    typeof filename !== 'string'
    || filename.length === 0
    || filename === '.'
    || filename === '..'
    || filename.includes('/')
    || filename.includes('\\')
  ))
  if (invalidFilename !== undefined) {
    throw new Error(`OpenForge CLI runtime asset manifest contains an invalid filename at ${manifestPath}`)
  }
  if (new Set(runtimeFiles).size !== runtimeFiles.length) {
    throw new Error(`OpenForge CLI runtime asset manifest contains duplicate filenames at ${manifestPath}`)
  }

  return runtimeFiles
}

async function readOpenForgeCliRuntimeFiles(cliSourceDir) {
  const manifestPath = join(cliSourceDir, OPENFORGE_CLI_RUNTIME_ASSET_MANIFEST_FILE)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  return validateOpenForgeCliRuntimeAssetManifest(manifest, manifestPath)
}

function isBuiltinPluginCatalogEntry(value) {
  return Boolean(value && typeof value.id === 'string' && typeof value.directoryName === 'string')
}

export async function readBuiltinPluginCatalog(repoRoot = repoRootFromScript()) {
  const catalogPath = join(repoRoot, BUILTIN_PLUGIN_CATALOG_FILE)
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  if (!catalog || !Array.isArray(catalog.plugins) || !catalog.plugins.every(isBuiltinPluginCatalogEntry)) {
    throw new Error(`Built-in plugin catalog must contain a plugins array with id and directoryName entries at ${catalogPath}`)
  }
  return catalog.plugins
}

export async function copyIcon(rustSidecarLayout, resourcesDir) {
  if (!(await pathExists(rustSidecarLayout.iconPath))) return
  await cp(rustSidecarLayout.iconPath, join(resourcesDir, 'electron.icns'))
}

export async function copyOpenForgeCliAssets(repoRoot, resourcesDir, rustSidecarLayout = resolveRustSidecarLayout({ repoRoot })) {
  const cliSourceDir = join(rustSidecarLayout.backendCrateRootPath, 'src', 'openforge-cli')
  if (!(await pathExists(cliSourceDir))) return
  const runtimeFiles = await readOpenForgeCliRuntimeFiles(cliSourceDir)
  for (const filename of runtimeFiles) {
    await assertExists(join(cliSourceDir, filename), `OpenForge CLI runtime module ${filename}`)
  }

  const skillSourcePath = join(cliSourceDir, 'openforge-skill.md')
  const pluginDevSkillSourcePath = join(cliSourceDir, 'openforge-plugin-dev-skill.md')
  await assertExists(skillSourcePath, 'OpenForge CLI skill template')
  await assertExists(pluginDevSkillSourcePath, 'OpenForge plugin dev skill template')

  const cliResourcesDir = join(resourcesDir, 'openforge-cli')
  await rm(cliResourcesDir, { recursive: true, force: true })
  await mkdir(cliResourcesDir, { recursive: true })
  for (const filename of runtimeFiles) {
    await cp(join(cliSourceDir, filename), join(cliResourcesDir, filename))
  }
  await cp(skillSourcePath, join(cliResourcesDir, 'openforge-skill.md'))
  await cp(pluginDevSkillSourcePath, join(cliResourcesDir, 'openforge-plugin-dev-skill.md'))
}

export async function copyBuiltinPluginRuntimeArtifacts(repoRoot, appResourcesPath) {
  const builtinPlugins = await readBuiltinPluginCatalog(repoRoot)

  for (const { id, directoryName } of builtinPlugins) {
    const pluginSourceDir = join(repoRoot, 'plugins', directoryName)
    await assertExists(pluginSourceDir, `Built-in plugin ${id} source directory`)

    const packageJsonPath = join(pluginSourceDir, 'package.json')
    const distDir = join(pluginSourceDir, 'dist')
    await assertExists(packageJsonPath, `Built-in plugin ${id} package.json`)
    await assertExists(distDir, `Built-in plugin ${id} dist artifacts`)

    const pluginTargetDir = join(appResourcesPath, 'plugins', directoryName)
    await rm(pluginTargetDir, { recursive: true, force: true })
    await mkdir(pluginTargetDir, { recursive: true })
    await cp(packageJsonPath, join(pluginTargetDir, 'package.json'))
    await cp(distDir, join(pluginTargetDir, 'dist'), { recursive: true })
  }
}

export async function copyElectronAppRuntimeDependencies(repoRoot, appResourcesPath, declaredDependencies = {}) {
  const packagedDependencies = {}

  for (const packageName of ELECTRON_APP_RUNTIME_DEPENDENCIES) {
    const packagePathParts = packageName.split('/')
    const installedPackagePath = join(repoRoot, 'node_modules', ...packagePathParts)
    await assertExists(installedPackagePath, `Electron app runtime dependency ${packageName}`)

    const sourcePackagePath = await realpath(installedPackagePath)
    const dependencyPackageJson = JSON.parse(await readFile(join(sourcePackagePath, 'package.json'), 'utf8'))
    packagedDependencies[packageName] = declaredDependencies[packageName] ?? dependencyPackageJson.version

    const targetPackagePath = join(appResourcesPath, 'node_modules', ...packagePathParts)
    await rm(targetPackagePath, { recursive: true, force: true })
    await mkdir(dirname(targetPackagePath), { recursive: true })
    await cp(sourcePackagePath, targetPackagePath, { recursive: true })
  }

  return packagedDependencies
}

export async function copyBackendPluginHostRuntime(electronDist, macosDir) {
  const bundledHostEntrypoint = join(electronDist, 'plugin-host', 'index.js')
  await assertExists(bundledHostEntrypoint, 'Bundled backend plugin host runtime')

  const pluginHostDir = join(macosDir, 'plugin-host')
  await rm(pluginHostDir, { recursive: true, force: true })
  await mkdir(pluginHostDir, { recursive: true })
  await cp(bundledHostEntrypoint, join(pluginHostDir, 'index.js'))
}
