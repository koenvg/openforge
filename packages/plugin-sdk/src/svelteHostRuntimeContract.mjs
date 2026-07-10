import { createHash } from 'node:crypto'

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

const OPENFORGE_HOST_RUNTIME_SVELTE_MODULE_SET = new Set(OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS)

/**
 * True for the Svelte host-runtime specifiers the HOST renderer build must externalize.
 *
 * Externalizing these makes the host emit bare `svelte` / `svelte/internal/client` imports
 * that resolve through the injected renderer import map to `plugin://host-runtime/svelte`
 * — the same Svelte instance external plugins load. Host + plugins then share ONE Svelte
 * instance, so mounting an external plugin component from the host tree no longer throws
 * `effect_orphan`. Deliberately Svelte-only: once Svelte is external, host-bundled
 * terminal-runtime resolves Svelte to the shared instance too, so nothing wider is needed.
 */
export function isOpenForgeHostRuntimeSvelteExternal(id) {
  return OPENFORGE_HOST_RUNTIME_SVELTE_MODULE_SET.has(id)
}

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

export function terminalRuntimeImportMapEntries() {
  return {
    '@openforge-app/terminal-runtime': 'plugin://host-runtime/terminal-runtime/index.js',
    '@openforge-app/terminal-runtime/terminalRuntime': 'plugin://host-runtime/terminal-runtime/terminalRuntime.js',
    '@openforge-app/terminal-runtime/terminalOptions': 'plugin://host-runtime/terminal-runtime/terminalOptions.js',
    '@openforge-app/terminal-runtime/theme': 'plugin://host-runtime/terminal-runtime/theme.js',
    '@openforge-app/terminal-runtime/shortcuts': 'plugin://host-runtime/terminal-runtime/shortcuts.js',
    '@openforge-app/terminal-runtime/shortcutController': 'plugin://host-runtime/terminal-runtime/shortcutController.js',
    '@openforge-app/terminal-runtime/TerminalTabsShell': 'plugin://host-runtime/terminal-runtime/TerminalTabsShell.js',
  }
}

export function rendererImportMapEntries() {
  return {
    ...svelteHostRuntimeImportMapEntries(),
    '@openforge-app/plugin-sdk': 'plugin://host-runtime/plugin-sdk/index.js',
    ...terminalRuntimeImportMapEntries(),
  }
}

export function rendererImportMapScriptBody() {
  return `\n${JSON.stringify({ imports: rendererImportMapEntries() }, null, 2)}\n`
}

export function rendererImportMapScriptSha256() {
  return `sha256-${createHash('sha256').update(rendererImportMapScriptBody(), 'utf8').digest('base64')}`
}

export function rendererImportMapScriptHashSource() {
  return `'${rendererImportMapScriptSha256()}'`
}

export function rendererImportMapHtml() {
  return `<script type="importmap">${rendererImportMapScriptBody()}</script>`
}
