export type OpenForgePluginSdkConditionalExport = Readonly<{
  types: `./dist/${string}.d.ts`
  default: `./dist/${string}.js`
}>

export type OpenForgePluginSdkPublicEntrypoint = Readonly<{
  packageSubpath: '.' | `./${string}`
  importSpecifier: '@openforge-app/plugin-sdk' | `@openforge-app/plugin-sdk/${string}`
  sourcePath: `src/${string}`
  workspaceSourcePath: `packages/plugin-sdk/src/${string}`
  packageExport: string | OpenForgePluginSdkConditionalExport
}>

export const OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS: readonly OpenForgePluginSdkPublicEntrypoint[]

export function createOpenForgePluginSdkPackageExports(): Record<
  string,
  string | { types: string; default: string }
>

export function createOpenForgePluginSdkTypeScriptPaths(): Record<string, [string]>

export function loadOpenForgePluginSdkTypeScriptPaths(workspaceRoot: string): Promise<Record<string, unknown>>
export function assertOpenForgePluginSdkEntrypointRegistries(registries: {
  packageExports: unknown
  typeScriptPaths: unknown
}): void
