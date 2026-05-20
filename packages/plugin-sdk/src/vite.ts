/**
 * Svelte browser/runtime entrypoints that OpenForge frontend plugin bundles must
 * share with the host renderer. The Electron renderer import map and packaged
 * plugin://host-runtime assets are derived from the same host-runtime contract.
 */
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS as HOST_RUNTIME_SVELTE_SPECIFIERS } from './svelteHostRuntimeContract.mjs'

export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS = HOST_RUNTIME_SVELTE_SPECIFIERS

export const OPENFORGE_HOST_SHARED_SVELTE_IMPORTS = OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS

export type OpenForgeHostRuntimeSvelteSpecifier = typeof OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS[number]
export type OpenForgeHostSharedSvelteImport = OpenForgeHostRuntimeSvelteSpecifier

const OPENFORGE_HOST_RUNTIME_SVELTE_MODULES = new Set<string>(OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS)

export function isOpenForgeHostRuntimeExternal(id: string): boolean {
  return OPENFORGE_HOST_RUNTIME_SVELTE_MODULES.has(id)
}

export const openforgePluginViteExternals = isOpenForgeHostRuntimeExternal
