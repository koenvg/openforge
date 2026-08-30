/**
 * Svelte browser/runtime entrypoints that OpenForge frontend plugin bundles must
 * share with the host renderer. The Electron renderer import map and packaged
 * plugin://host-runtime assets are derived from the same host-runtime contract.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS } from './publicEntrypoints.mjs'
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS as HOST_RUNTIME_SVELTE_SPECIFIERS } from './svelteHostRuntimeContract.mjs'

export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS = HOST_RUNTIME_SVELTE_SPECIFIERS

export const OPENFORGE_HOST_SHARED_SVELTE_IMPORTS = OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS
export const OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS = Object.freeze([
  '@openforge-app/terminal-runtime',
  '@openforge-app/terminal-runtime/terminalRuntime',
  '@openforge-app/terminal-runtime/terminalOptions',
  '@openforge-app/terminal-runtime/theme',
  '@openforge-app/terminal-runtime/shortcuts',
  '@openforge-app/terminal-runtime/shortcutController',
  '@openforge-app/terminal-runtime/TerminalTabsShell',
])

export type OpenForgeHostRuntimeSvelteSpecifier = typeof OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS[number]
export type OpenForgeHostSharedSvelteImport = OpenForgeHostRuntimeSvelteSpecifier
export type OpenForgeHostSharedTerminalRuntimeImport = typeof OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS[number]

const OPENFORGE_HOST_RUNTIME_MODULES = new Set<string>([
  ...OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS,
  ...OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS,
])

export function isOpenForgeHostRuntimeExternal(id: string): boolean {
  return OPENFORGE_HOST_RUNTIME_MODULES.has(id)
}

export const openforgePluginViteExternals = isOpenForgeHostRuntimeExternal

export type OpenForgePluginSdkSourceAlias = Readonly<{
  find: string
  replacement: string
}>

export type OpenForgePluginSdkSourceAliasRecord = Readonly<Record<string, string>>

const OPENFORGE_PLUGIN_SDK_SOURCE_ENTRYPOINTS: readonly (readonly [string, string])[] = Object.freeze([
  ...OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS
    .filter(({ packageSubpath }) => packageSubpath !== '.')
    .map(({ importSpecifier, workspaceSourcePath }) => [importSpecifier, workspaceSourcePath] as const),
  ...OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS
    .filter(({ packageSubpath }) => packageSubpath === '.')
    .map(({ importSpecifier, workspaceSourcePath }) => [importSpecifier, workspaceSourcePath] as const),
])

function repoRootUrl(repoRoot: URL | string): URL {
  if (repoRoot instanceof URL) {
    return new URL(repoRoot.href.endsWith('/') ? repoRoot.href : `${repoRoot.href}/`)
  }

  if (isUrlString(repoRoot)) {
    return new URL(repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`)
  }

  return pathToFileURL(hasTrailingPathSeparator(repoRoot) ? repoRoot : `${repoRoot}/`)
}

function isUrlString(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^file:/i.test(value)
}

function hasTrailingPathSeparator(value: string): boolean {
  return value.endsWith('/') || value.endsWith('\\')
}

function sourceAliasReplacement(sourceUrl: URL): string {
  if (sourceUrl.protocol === 'file:') {
    return fileURLToPath(sourceUrl)
  }

  return sourceUrl.pathname
}

function createOpenForgePluginSdkSourceAliasEntries(repoRoot: URL | string): [string, string][] {
  const rootUrl = repoRootUrl(repoRoot)

  return OPENFORGE_PLUGIN_SDK_SOURCE_ENTRYPOINTS.map(([find, sourcePath]) => [
    find,
    sourceAliasReplacement(new URL(sourcePath, rootUrl)),
  ])
}

export function createOpenForgePluginSdkSourceAliases(repoRoot: URL | string): OpenForgePluginSdkSourceAlias[] {
  return createOpenForgePluginSdkSourceAliasEntries(repoRoot).map(([find, replacement]) => ({
    find,
    replacement,
  }))
}

export function createOpenForgePluginSdkSourceAliasRecord(repoRoot: URL | string): OpenForgePluginSdkSourceAliasRecord {
  return Object.fromEntries(createOpenForgePluginSdkSourceAliasEntries(repoRoot))
}
