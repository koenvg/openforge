export type SvelteHostRuntimeModule = Readonly<{
  specifier: string
  sourcePath: string
  assetPath: string
}>

export const SVELTE_HOST_RUNTIME_MODULES: readonly SvelteHostRuntimeModule[]
export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS: readonly string[]
export const SVELTE_HOST_RUNTIME_IMPORTS: Readonly<Record<string, string>>
export function svelteHostRuntimeImportUrl(specifier: string): string | null
export function svelteHostRuntimeBuildEntries(): Record<string, string>
export function svelteHostRuntimeImportMapEntries(): Record<string, string>
export function terminalRuntimeImportMapEntries(): Record<string, string>
export function rendererImportMapEntries(): Record<string, string>
export function rendererImportMapScriptBody(): string
export function rendererImportMapScriptSha256(): string
export function rendererImportMapScriptHashSource(): string
export function rendererImportMapHtml(): string
