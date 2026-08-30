import { isDeepStrictEqual } from 'node:util'
import { OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS } from './publicUiExports.mjs'

const PLUGIN_SDK_PACKAGE_NAME = '@openforge-app/plugin-sdk'

function moduleEntrypoint(packageSubpath, sourceName) {
  const importSuffix = packageSubpath === '.' ? '' : packageSubpath.slice(1)
  return Object.freeze({
    packageSubpath,
    importSpecifier: `${PLUGIN_SDK_PACKAGE_NAME}${importSuffix}`,
    sourcePath: `src/${sourceName}.ts`,
    workspaceSourcePath: `packages/plugin-sdk/src/${sourceName}.ts`,
    packageExport: Object.freeze({
      types: `./dist/${sourceName}.d.ts`,
      default: `./dist/${sourceName}.js`,
    }),
  })
}

const PUBLIC_MODULE_ENTRYPOINTS = [
  moduleEntrypoint('.', 'index'),
  moduleEntrypoint('./frontend', 'frontend'),
  moduleEntrypoint('./backend', 'backend'),
  moduleEntrypoint('./testing', 'testing'),
  moduleEntrypoint('./vite', 'vite'),
  moduleEntrypoint('./domain', 'domain'),
  moduleEntrypoint('./prStatusPresentation', 'prStatusPresentation'),
  moduleEntrypoint('./markdown', 'markdown'),
  moduleEntrypoint('./numberParsing', 'numberParsing'),
  moduleEntrypoint('./projectFileTree', 'projectFileTree'),
  moduleEntrypoint('./sanitize', 'sanitize'),
  moduleEntrypoint('./pluginIcons', 'pluginIcons'),
  moduleEntrypoint('./fileIcons', 'fileIcons'),
  moduleEntrypoint('./collapsibleSectionState', 'collapsibleSectionState'),
  moduleEntrypoint('./taskBrowserDevToolsShortcuts', 'taskBrowserDevToolsShortcuts'),
]

const PACKAGE_METADATA_SCHEMA_ENTRYPOINT = Object.freeze({
  packageSubpath: './package-metadata-schema.json',
  importSpecifier: `${PLUGIN_SDK_PACKAGE_NAME}/package-metadata-schema.json`,
  sourcePath: 'src/openforgePackageMetadataSchema.json',
  workspaceSourcePath: 'packages/plugin-sdk/src/openforgePackageMetadataSchema.json',
  packageExport: './dist/openforgePackageMetadataSchema.json',
})

const PUBLIC_UI_ENTRYPOINTS = OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map((entrypoint) => Object.freeze({
  packageSubpath: entrypoint.packageSubpath,
  importSpecifier: entrypoint.importSpecifier,
  sourcePath: entrypoint.sourcePath,
  workspaceSourcePath: entrypoint.workspaceSourcePath,
  packageExport: entrypoint.distPath,
}))

/** Canonical registrations for every public Plugin SDK entrypoint. */
export const OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS = Object.freeze([
  ...PUBLIC_MODULE_ENTRYPOINTS.slice(0, 5),
  PACKAGE_METADATA_SCHEMA_ENTRYPOINT,
  ...PUBLIC_MODULE_ENTRYPOINTS.slice(5),
  ...PUBLIC_UI_ENTRYPOINTS,
])

export function createOpenForgePluginSdkPackageExports() {
  return Object.fromEntries(
    OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS.map(({ packageSubpath, packageExport }) => [
      packageSubpath,
      typeof packageExport === 'string' ? packageExport : { ...packageExport },
    ]),
  )
}

export function createOpenForgePluginSdkTypeScriptPaths() {
  return Object.fromEntries(
    OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS.map(({ importSpecifier, workspaceSourcePath }) => [
      importSpecifier,
      [`./${workspaceSourcePath}`],
    ]),
  )
}

export function assertOpenForgePluginSdkEntrypointRegistries({ packageExports, typeScriptPaths }) {
  assertRegistryMatches('package exports', packageExports, createOpenForgePluginSdkPackageExports())
  assertRegistryMatches('root TypeScript paths', typeScriptPaths, createOpenForgePluginSdkTypeScriptPaths())
}

function assertRegistryMatches(registryName, actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(`Plugin SDK ${registryName} must be an object`)
  }

  const missingOrMismatched = Object.entries(expected)
    .filter(([key, value]) => !isDeepStrictEqual(actual[key], value))
    .map(([key]) => key)
  const unexpected = Object.keys(actual).filter((key) => !(key in expected))

  if (missingOrMismatched.length === 0 && unexpected.length === 0) return

  const details = [
    missingOrMismatched.length > 0 ? `missing or mismatched: ${missingOrMismatched.join(', ')}` : null,
    unexpected.length > 0 ? `not in the canonical manifest: ${unexpected.join(', ')}` : null,
  ].filter(Boolean)

  throw new Error(`Plugin SDK ${registryName} drifted from the canonical manifest (${details.join('; ')})`)
}
