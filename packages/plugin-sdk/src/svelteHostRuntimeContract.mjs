const HOST_RUNTIME_SVELTE_BASE_URL = 'plugin://host-runtime/svelte/'

export const SVELTE_HOST_RUNTIME_MODULES = Object.freeze([
  { specifier: 'svelte', sourcePath: 'index-client.js', assetPath: 'index.js' },
  { specifier: 'svelte/animate', sourcePath: 'animate/index.js', assetPath: 'animate.js' },
  { specifier: 'svelte/attachments', sourcePath: 'attachments/index.js', assetPath: 'attachments.js' },
  { specifier: 'svelte/easing', sourcePath: 'easing/index.js', assetPath: 'easing.js' },
  { specifier: 'svelte/events', sourcePath: 'events/index.js', assetPath: 'events.js' },
  { specifier: 'svelte/internal', sourcePath: 'internal/index.js', assetPath: 'internal.js' },
  { specifier: 'svelte/internal/client', sourcePath: 'internal/client/index.js', assetPath: 'internal/client/index.js' },
  { specifier: 'svelte/internal/disclose-version', sourcePath: 'internal/disclose-version.js', assetPath: 'internal/disclose-version.js' },
  { specifier: 'svelte/internal/flags/async', sourcePath: 'internal/flags/async.js', assetPath: 'internal/flags/async.js' },
  { specifier: 'svelte/internal/flags/legacy', sourcePath: 'internal/flags/legacy.js', assetPath: 'internal/flags/legacy.js' },
  { specifier: 'svelte/internal/flags/tracing', sourcePath: 'internal/flags/tracing.js', assetPath: 'internal/flags/tracing.js' },
  { specifier: 'svelte/legacy', sourcePath: 'legacy/legacy-client.js', assetPath: 'legacy.js' },
  { specifier: 'svelte/motion', sourcePath: 'motion/index.js', assetPath: 'motion.js' },
  { specifier: 'svelte/reactivity', sourcePath: 'reactivity/index-client.js', assetPath: 'reactivity.js' },
  { specifier: 'svelte/reactivity/window', sourcePath: 'reactivity/window/index.js', assetPath: 'reactivity/window/index.js' },
  { specifier: 'svelte/store', sourcePath: 'store/index-client.js', assetPath: 'store.js' },
  { specifier: 'svelte/transition', sourcePath: 'transition/index.js', assetPath: 'transition.js' },
])

export const OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS = Object.freeze(
  SVELTE_HOST_RUNTIME_MODULES.map(module => module.specifier),
)

export const SVELTE_HOST_RUNTIME_IMPORTS = Object.freeze(Object.fromEntries(
  SVELTE_HOST_RUNTIME_MODULES.map(module => [module.specifier, `${HOST_RUNTIME_SVELTE_BASE_URL}${module.assetPath}`]),
))

export function svelteHostRuntimeImportUrl(specifier) {
  return SVELTE_HOST_RUNTIME_IMPORTS[specifier] ?? null
}

export function svelteHostRuntimeBuildEntries() {
  return Object.fromEntries(
    SVELTE_HOST_RUNTIME_MODULES.map(module => [module.assetPath.replace(/\.js$/, ''), module.sourcePath]),
  )
}

export function svelteHostRuntimeImportMapEntries() {
  return { ...SVELTE_HOST_RUNTIME_IMPORTS }
}

export function rendererImportMapEntries() {
  return {
    ...svelteHostRuntimeImportMapEntries(),
    '@openforge/plugin-sdk': 'plugin://host-runtime/plugin-sdk/index.js',
  }
}

export function rendererImportMapHtml() {
  return `<script type="importmap">\n${JSON.stringify({ imports: rendererImportMapEntries() }, null, 2)}\n</script>`
}
