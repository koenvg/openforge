#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { buildAndPackageElectronApp } from './electron-package/build-orchestration.mjs'
import { packageElectronApp } from './electron-package/package-assembly.mjs'
import { repoRootFromScript } from './electron-package/repo-root.mjs'

export {
  APP_NAME,
  ELECTRON_APP_NAME,
  ELECTRON_APP_PACKAGE_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  createElectronAppPackageJson,
  electronBundlePath,
  sidecarBinaryPathForTarget,
  updatePlistBooleanValue,
  updatePlistStringValue,
} from './electron-package/app-metadata.mjs'
export {
  assertPackageArchitectureCompatibility,
  expectedDarwinArchForTarget,
  readDarwinExecutableArchitectures,
} from './electron-package/architecture-validation.mjs'
export { buildAndPackageElectronApp } from './electron-package/build-orchestration.mjs'
export { packageElectronApp } from './electron-package/package-assembly.mjs'
export { hydrateElectronTemplate } from './electron-package/runtime-hydration.mjs'
export {
  BUILTIN_PLUGIN_CATALOG_FILE,
  ELECTRON_APP_RUNTIME_DEPENDENCIES,
  readBuiltinPluginCatalog,
  validateOpenForgeCliRuntimeAssetManifest,
} from './electron-package/runtime-assets.mjs'

async function main() {
  const skipBuild = process.argv.includes('--skip-build')
  const result = skipBuild
    ? await packageElectronApp({ repoRoot: repoRootFromScript() })
    : await buildAndPackageElectronApp({ repoRoot: repoRootFromScript() })
  console.log(`Packaged Electron app at ${result.appPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
