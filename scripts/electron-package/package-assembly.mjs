import { chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { electronPackageIdentityForRepoRoot } from '../data-identity.mjs'
import { resolveRustSidecarLayout } from '../rust-sidecar-layout.mjs'
import {
  APP_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  createElectronAppPackageJson,
  updatePlistBooleanValue,
  updatePlistStringValue,
} from './app-metadata.mjs'
import {
  assertPackageArchitectureCompatibility,
  readDarwinExecutableArchitectures,
} from './architecture-validation.mjs'
import { hydrateElectronTemplate } from './runtime-hydration.mjs'
import {
  copyBackendPluginHostRuntime,
  copyBuiltinPluginRuntimeArtifacts,
  copyElectronAppRuntimeDependencies,
  copyIcon,
  copyOpenForgeCliAssets,
} from './runtime-assets.mjs'
import { assertExists, pathExists } from './file-system.mjs'
import { repoRootFromScript } from './repo-root.mjs'

async function updateInfoPlist(appPath, { appName = APP_NAME, bundleIdentifier = ELECTRON_BUNDLE_IDENTIFIER } = {}) {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let plist = await readFile(plistPath, 'utf8')
  plist = updatePlistStringValue(plist, 'CFBundleExecutable', appName)
  plist = updatePlistStringValue(plist, 'CFBundleName', appName)
  plist = updatePlistStringValue(plist, 'CFBundleDisplayName', appName)
  plist = updatePlistStringValue(plist, 'CFBundleIdentifier', bundleIdentifier)
  plist = updatePlistBooleanValue(plist, 'ApplePressAndHoldEnabled', false)
  await writeFile(plistPath, plist)
}

const ELECTRON_HELPER_APP_PATTERN = /^Electron Helper(?: \(([^)]+)\))?\.app$/
const ELECTRON_HELPER_ROLES = Object.freeze(['', 'GPU', 'Renderer', 'Plugin'])

function electronHelperPaths(frameworksDir, appName, role) {
  const roleSuffix = role ? ` (${role})` : ''
  const electronHelperName = `Electron Helper${roleSuffix}`
  const appHelperName = `${appName} Helper${roleSuffix}`
  const electronHelperAppPath = join(frameworksDir, `${electronHelperName}.app`)
  const macosDir = join(electronHelperAppPath, 'Contents', 'MacOS')
  return {
    role,
    electronHelperName,
    appHelperName,
    electronHelperAppPath,
    appHelperAppPath: join(frameworksDir, `${appHelperName}.app`),
    electronHelperExecutablePath: join(macosDir, electronHelperName),
    appHelperExecutablePath: join(macosDir, appHelperName),
    plistPath: join(electronHelperAppPath, 'Contents', 'Info.plist'),
  }
}

async function brandElectronHelperApps(appPath, { appName, bundleIdentifier }) {
  const frameworksDir = join(appPath, 'Contents', 'Frameworks')
  await assertExists(frameworksDir, 'Electron Frameworks directory')
  const helpers = ELECTRON_HELPER_ROLES.map(role => electronHelperPaths(frameworksDir, appName, role))

  for (const helper of helpers) {
    await assertExists(helper.electronHelperAppPath, `${helper.electronHelperName} app bundle`)
    await assertExists(helper.electronHelperExecutablePath, `${helper.electronHelperName} executable`)
    await assertExists(helper.plistPath, `${helper.electronHelperName} Info.plist`)
  }

  for (const helper of helpers) {
    await rename(helper.electronHelperExecutablePath, helper.appHelperExecutablePath)
    await chmod(helper.appHelperExecutablePath, 0o755)

    const helperBundleIdentifier = `${bundleIdentifier}.helper${helper.role ? `.${helper.role}` : ''}`
    let plist = await readFile(helper.plistPath, 'utf8')
    plist = updatePlistStringValue(plist, 'CFBundleExecutable', helper.appHelperName)
    plist = updatePlistStringValue(plist, 'CFBundleName', helper.appHelperName)
    plist = updatePlistStringValue(plist, 'CFBundleDisplayName', helper.appHelperName)
    plist = updatePlistStringValue(plist, 'CFBundleIdentifier', helperBundleIdentifier)
    await writeFile(helper.plistPath, plist)

    await rename(helper.electronHelperAppPath, helper.appHelperAppPath)
  }

  const unbrandedHelpers = (await readdir(frameworksDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && ELECTRON_HELPER_APP_PATTERN.test(entry.name))
    .map(entry => entry.name)
  if (unbrandedHelpers.length > 0) {
    throw new Error(`Electron helper branding left unrecognized bundles: ${unbrandedHelpers.join(', ')}`)
  }
}

export async function packageElectronApp({
  repoRoot = repoRootFromScript(),
  packageIdentity = electronPackageIdentityForRepoRoot(repoRoot),
  rustSidecarLayout = resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName }),
  outputAppPath = rustSidecarLayout.electronAppPath,
  electronPackageRoot = join(repoRoot, 'node_modules', 'electron'),
  electronTemplatePath = join(repoRoot, 'node_modules', 'electron', 'dist', packageIdentity.electronTemplateAppName),
  hydrateElectronTemplate: hydrateTemplate = hydrateElectronTemplate,
  cargoBuildTarget = process.env.CARGO_BUILD_TARGET ?? '',
  sidecarBinaryPath = rustSidecarLayout.releaseSidecarBinaryPath({ cargoBuildTarget }),
  readExecutableArchitectures = readDarwinExecutableArchitectures,
} = {}) {
  const rendererDist = join(repoRoot, 'dist')
  const electronDist = join(repoRoot, 'dist-electron')

  await hydrateTemplate({
    repoRoot,
    electronPackageRoot,
    electronTemplatePath,
    electronTemplateAppName: packageIdentity.electronTemplateAppName,
  })
  await assertExists(electronTemplatePath, 'Electron app template')
  await assertExists(rendererDist, 'Renderer build')
  await assertExists(electronDist, 'Electron main build')
  await assertExists(sidecarBinaryPath, 'Rust sidecar binary')

  await rm(outputAppPath, { recursive: true, force: true })
  await mkdir(dirname(outputAppPath), { recursive: true })
  await cp(electronTemplatePath, outputAppPath, { recursive: true, verbatimSymlinks: true })

  const macosDir = join(outputAppPath, 'Contents', 'MacOS')
  const resourcesDir = join(outputAppPath, 'Contents', 'Resources')
  const electronExecutablePath = join(macosDir, 'Electron')
  const appExecutablePath = join(macosDir, packageIdentity.appName)
  if (await pathExists(electronExecutablePath)) {
    await rename(electronExecutablePath, appExecutablePath)
  }
  await chmod(appExecutablePath, 0o755)

  const sidecarTargetPath = join(macosDir, 'openforge-sidecar')
  await cp(sidecarBinaryPath, sidecarTargetPath)
  await chmod(sidecarTargetPath, 0o755)
  await copyBackendPluginHostRuntime(electronDist, macosDir)

  await assertPackageArchitectureCompatibility({
    cargoBuildTarget,
    appExecutablePath,
    sidecarPath: sidecarTargetPath,
    readExecutableArchitectures,
  })

  const appResourcesPath = join(resourcesDir, 'app')
  await rm(appResourcesPath, { recursive: true, force: true })
  await mkdir(appResourcesPath, { recursive: true })
  await cp(rendererDist, join(appResourcesPath, 'dist'), { recursive: true })
  await cp(electronDist, join(appResourcesPath, 'dist-electron'), { recursive: true })
  await copyBuiltinPluginRuntimeArtifacts(repoRoot, appResourcesPath)

  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8').catch(() => '{"version":"0.0.1"}'))
  const runtimeDependencies = await copyElectronAppRuntimeDependencies(repoRoot, appResourcesPath, rootPackage.dependencies ?? {})
  await writeFile(join(appResourcesPath, 'package.json'), `${JSON.stringify(createElectronAppPackageJson({
    version: rootPackage.version ?? '0.0.1',
    packageName: packageIdentity.electronAppPackageName,
    dependencies: runtimeDependencies,
  }), null, 2)}\n`)

  await updateInfoPlist(outputAppPath, {
    appName: packageIdentity.appName,
    bundleIdentifier: packageIdentity.bundleIdentifier,
  })
  await brandElectronHelperApps(outputAppPath, {
    appName: packageIdentity.appName,
    bundleIdentifier: packageIdentity.bundleIdentifier,
  })
  await copyIcon(rustSidecarLayout, resourcesDir)
  await copyOpenForgeCliAssets(repoRoot, resourcesDir, rustSidecarLayout)

  return { appPath: outputAppPath, sidecarPath: sidecarTargetPath }
}
