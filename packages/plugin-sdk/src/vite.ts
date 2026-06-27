/**
 * Svelte browser/runtime entrypoints that OpenForge frontend plugin bundles must
 * share with the host renderer. The Electron renderer import map and packaged
 * plugin://host-runtime assets are derived from the same host-runtime contract.
 */
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
  '@openforge/terminal-runtime/TerminalTabsShell',
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
