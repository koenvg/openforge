/**
 * Svelte browser/runtime entrypoints that OpenForge frontend plugin bundles must
 * share with the host renderer. The Electron renderer import map and packaged
 * plugin://host-runtime assets must cover every specifier in this list.
 */
export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS = [
  'svelte',
  'svelte/animate',
  'svelte/attachments',
  'svelte/easing',
  'svelte/events',
  'svelte/internal',
  'svelte/internal/client',
  'svelte/internal/disclose-version',
  'svelte/internal/flags/async',
  'svelte/internal/flags/legacy',
  'svelte/internal/flags/tracing',
  'svelte/legacy',
  'svelte/motion',
  'svelte/reactivity',
  'svelte/reactivity/window',
  'svelte/store',
  'svelte/transition',
] as const

export const OPENFORGE_HOST_SHARED_SVELTE_IMPORTS = OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS

export type OpenForgeHostRuntimeSvelteSpecifier = typeof OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS[number]
export type OpenForgeHostSharedSvelteImport = OpenForgeHostRuntimeSvelteSpecifier

const OPENFORGE_HOST_RUNTIME_SVELTE_MODULES = new Set<string>(OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS)

export function isOpenForgeHostRuntimeExternal(id: string): boolean {
  return OPENFORGE_HOST_RUNTIME_SVELTE_MODULES.has(id)
}

export const openforgePluginViteExternals = isOpenForgeHostRuntimeExternal
