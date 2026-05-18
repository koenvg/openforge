const OPENFORGE_HOST_RUNTIME_SVELTE_MODULES = new Set([
  'svelte/animate',
  'svelte/attachments',
  'svelte/easing',
  'svelte/events',
  'svelte/internal',
  'svelte/internal/client',
  'svelte/internal/disclose-version',
  'svelte/legacy',
  'svelte/motion',
  'svelte/reactivity',
  'svelte/reactivity/window',
  'svelte/store',
  'svelte/transition',
])

export function isOpenForgeHostRuntimeExternal(id: string): boolean {
  return id === 'svelte'
    || OPENFORGE_HOST_RUNTIME_SVELTE_MODULES.has(id)
    || id.startsWith('svelte/internal/flags/')
}

export const openforgePluginViteExternals = isOpenForgeHostRuntimeExternal
