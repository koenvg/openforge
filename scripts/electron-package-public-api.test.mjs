import { describe, expect, it } from 'vitest'
import * as electronPackage from './electron-package.mjs'

describe('Electron packaging public API', () => {
  it('keeps the established exports available from electron-package.mjs', () => {
    expect(Object.keys(electronPackage).sort()).toEqual([
      'APP_NAME',
      'BUILTIN_PLUGIN_CATALOG_FILE',
      'ELECTRON_APP_NAME',
      'ELECTRON_APP_PACKAGE_NAME',
      'ELECTRON_APP_RUNTIME_DEPENDENCIES',
      'ELECTRON_BUNDLE_IDENTIFIER',
      'assertPackageArchitectureCompatibility',
      'buildAndPackageElectronApp',
      'createElectronAppPackageJson',
      'electronBundlePath',
      'expectedDarwinArchForTarget',
      'hydrateElectronTemplate',
      'packageElectronApp',
      'readBuiltinPluginCatalog',
      'readDarwinExecutableArchitectures',
      'sidecarBinaryPathForTarget',
      'updatePlistBooleanValue',
      'updatePlistStringValue',
      'validateOpenForgeCliRuntimeAssetManifest',
    ])
  })
})
