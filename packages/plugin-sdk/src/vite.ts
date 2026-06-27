/**
 * Svelte browser/runtime entrypoints that OpenForge frontend plugin bundles must
 * share with the host renderer. The Electron renderer import map and packaged
 * plugin://host-runtime assets are derived from the same host-runtime contract.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS as HOST_RUNTIME_SVELTE_SPECIFIERS } from './svelteHostRuntimeContract.mjs'

export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS = HOST_RUNTIME_SVELTE_SPECIFIERS

export const OPENFORGE_HOST_SHARED_SVELTE_IMPORTS = OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS
export const OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS = Object.freeze([
  '@openforge/terminal-runtime',
  '@openforge/terminal-runtime/terminalRuntime',
  '@openforge/terminal-runtime/terminalOptions',
  '@openforge/terminal-runtime/theme',
  '@openforge/terminal-runtime/shortcuts',
  '@openforge/terminal-runtime/shortcutController',
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

const OPENFORGE_PLUGIN_SDK_SOURCE_ENTRYPOINTS = Object.freeze([
  ['@openforge/plugin-sdk/frontend', 'packages/plugin-sdk/src/frontend.ts'],
  ['@openforge/plugin-sdk/backend', 'packages/plugin-sdk/src/backend.ts'],
  ['@openforge/plugin-sdk/testing', 'packages/plugin-sdk/src/testing.ts'],
  ['@openforge/plugin-sdk/vite', 'packages/plugin-sdk/src/vite.ts'],
  ['@openforge/plugin-sdk/domain', 'packages/plugin-sdk/src/domain.ts'],
  ['@openforge/plugin-sdk/prStatusPresentation', 'packages/plugin-sdk/src/prStatusPresentation.ts'],
  ['@openforge/plugin-sdk/markdown', 'packages/plugin-sdk/src/markdown.ts'],
  ['@openforge/plugin-sdk/numberParsing', 'packages/plugin-sdk/src/numberParsing.ts'],
  ['@openforge/plugin-sdk/sanitize', 'packages/plugin-sdk/src/sanitize.ts'],
  ['@openforge/plugin-sdk/ui/MarkdownContent.svelte', 'packages/plugin-sdk/src/ui/MarkdownContent.svelte'],
  ['@openforge/plugin-sdk/ui/ResizablePanel.svelte', 'packages/plugin-sdk/src/ui/ResizablePanel.svelte'],
  ['@openforge/plugin-sdk', 'packages/plugin-sdk/src/index.ts'],
] as const)

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

export function createOpenForgePluginSdkSourceAliases(repoRoot: URL | string): OpenForgePluginSdkSourceAlias[] {
  const rootUrl = repoRootUrl(repoRoot)

  return OPENFORGE_PLUGIN_SDK_SOURCE_ENTRYPOINTS.map(([find, sourcePath]) => ({
    find,
    replacement: sourceAliasReplacement(new URL(sourcePath, rootUrl)),
  }))
}
