export type OpenForgePluginSdkPublicUiExport = Readonly<{
  componentName: string
  packageSubpath: `./ui/${string}.svelte`
  importSpecifier: `@openforge-app/plugin-sdk/ui/${string}.svelte`
  sourcePath: `src/ui/${string}.svelte`
  workspaceSourcePath: `packages/plugin-sdk/src/ui/${string}.svelte`
  distPath: `./dist/ui/${string}.svelte`
}>

export const OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS: readonly OpenForgePluginSdkPublicUiExport[]

export function createOpenForgePluginSdkPublicUiPackageExports(): Record<string, string>

export function assertOpenForgePluginSdkPublicUiPackageExports(
  packageExports: unknown,
): asserts packageExports is Record<string, unknown>
