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
  if (!packageExports || typeof packageExports !== 'object' || Array.isArray(packageExports)) {
    throw new Error('Plugin SDK package.json must define an exports object')
  }

  const expected = createOpenForgePluginSdkPublicUiPackageExports()
  const actual = Object.fromEntries(
    Object.entries(packageExports).filter(([subpath]) => subpath.startsWith('./ui/')),
  )
  const expectedEntries = Object.entries(expected)
  const missingOrMismatched = expectedEntries
    .filter(([subpath, distPath]) => actual[subpath] !== distPath)
    .map(([subpath, distPath]) => `${subpath} -> ${distPath}`)
  const unexpected = Object.keys(actual).filter((subpath) => !(subpath in expected))

  if (missingOrMismatched.length === 0 && unexpected.length === 0) return

  const details = [
    missingOrMismatched.length > 0 ? `missing or mismatched: ${missingOrMismatched.join(', ')}` : null,
    unexpected.length > 0 ? `not in the canonical manifest: ${unexpected.join(', ')}` : null,
  ].filter(Boolean)

  throw new Error(`Plugin SDK public UI exports drifted from the canonical manifest (${details.join('; ')})`)
}
