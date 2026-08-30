import { assertRegistryMatchesCanonicalManifest } from './registryValidation.mjs'

const PLUGIN_SDK_PACKAGE_NAME = '@openforge-app/plugin-sdk'

const PUBLIC_UI_COMPONENT_NAMES = Object.freeze([
  'Button',
  'Checkbox',
  'MarkdownContent',
  'ResizablePanel',
  'Modal',
  'PluginPageHeader',
  'PluginPageShell',
  'PluginViewState',
  'PluginSidebarLink',
  'FileTypeIcon',
  'ProjectFileTree',
  'CollapsibleSection',
])

/**
 * Canonical registrations for public Svelte components shipped by the plugin SDK.
 * Package exports are validated against this list; asset copying, source aliases,
 * root Vite aliases, and import-boundary fallbacks are derived from it.
 */
export const OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS = Object.freeze(
  PUBLIC_UI_COMPONENT_NAMES.map((componentName) => Object.freeze({
    componentName,
    packageSubpath: `./ui/${componentName}.svelte`,
    importSpecifier: `${PLUGIN_SDK_PACKAGE_NAME}/ui/${componentName}.svelte`,
    sourcePath: `src/ui/${componentName}.svelte`,
    workspaceSourcePath: `packages/plugin-sdk/src/ui/${componentName}.svelte`,
    distPath: `./dist/ui/${componentName}.svelte`,
  })),
)

export function createOpenForgePluginSdkPublicUiPackageExports() {
  return Object.fromEntries(
    OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map(({ packageSubpath, distPath }) => [packageSubpath, distPath]),
  )
}

export function assertOpenForgePluginSdkPublicUiPackageExports(packageExports) {
  assertRegistryMatchesCanonicalManifest({
    registryName: 'Plugin SDK public UI exports',
    actual: packageExports,
    expected: createOpenForgePluginSdkPublicUiPackageExports(),
    invalidRegistryMessage: 'Plugin SDK package.json must define an exports object',
    includeActualEntry: ([subpath]) => subpath.startsWith('./ui/'),
    formatMissingOrMismatched: ([subpath, distPath]) => `${subpath} -> ${distPath}`,
  })
}
