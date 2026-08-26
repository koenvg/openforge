import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { isOpenForgeHostRuntimeSvelteExternal, OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS, rendererImportMapHtml, svelteHostRuntimeImportUrl } from './packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
import { createOpenForgePluginSdkSourceAliases } from './packages/plugin-sdk/src/vite.ts'
import { createDaisyUiTailwindPluginAliases } from './src/lib/viteDaisyUi.ts'
import { createOpenForgeChunkGroups, OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT } from './src/lib/viteChunks.ts'
import { createOpenForgeViteLogger } from './src/lib/viteLogger.ts'
import { DESKTOP_ASSET_BASE } from './src/lib/viteDesktopBuild.ts'

function createOpenForgeHostRuntimeImportMapPlugin() {
  return {
    name: 'openforge-host-runtime-import-map',
    transformIndexHtml(html: string) {
      return html.replace('<!-- openforge-host-runtime-importmap -->', rendererImportMapHtml())
    },
  }
}

// Dev-serve counterpart to `build.rolldownOptions.external` below. `vite build`
// (packaged app) externalizes the host-runtime Svelte specifiers so the host emits
// bare `svelte` imports that resolve — via the injected import map — to the ONE
// shared `plugin://host-runtime/svelte` instance external plugins also load. But
// `build.*.external` does NOT apply to `vite` dev serve, and vite's dev server owns
// bare-specifier resolution (it will resolve `svelte` to its own node_modules copy
// rather than defer to the browser import map). So in dev we rewrite the host's
// Svelte imports directly to the same absolute `plugin://host-runtime/svelte/*` URLs
// the plugins load and mark them external — vite emits them verbatim, the browser
// loads them from Electron's plugin:// handler, and host + plugins share ONE Svelte
// instance. Without this the dev host pre-bundles a SECOND Svelte instance and
// mounting a plugin component throws `effect_orphan`.
function createOpenForgeHostRuntimeSvelteDevExternalPlugin() {
  return {
    name: 'openforge-host-runtime-svelte-dev-external',
    apply: 'serve' as const,
    enforce: 'pre' as const,
    resolveId(id: string) {
      const hostRuntimeUrl = svelteHostRuntimeImportUrl(id)
      return hostRuntimeUrl ? { id: hostRuntimeUrl, external: true } : null
    },
  }
}

function createOpenForgeRootAliases() {
  return [
    ...createOpenForgePluginSdkSourceAliases(new URL('./', import.meta.url)),
    {
      find: /^@openforge-app\/terminal-runtime$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/index.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/terminalRuntime$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalRuntime.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/terminalOptions$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalOptions.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/theme$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/theme.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/shortcuts$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalShortcuts.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/shortcutController$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalShortcutController.ts'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/TerminalTabsShell$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/TerminalTabsShell.svelte'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/TaskTerminalSurface$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/TaskTerminalSurface.svelte'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/TerminalTabsSurface$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/TerminalTabsSurface.svelte'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/TerminalTaskPaneSurface$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/xterm\.css$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/xterm.css'),
    },
    {
      find: /^@openforge-app\/terminal-runtime\/testUtils$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalView.testUtils.ts'),
    },
    ...createDaisyUiTailwindPluginAliases(),
  ]
}

// https://vitejs.dev/config/
export default defineConfig({
  // Electron packages load index.html through file://, so emitted asset URLs must
  // stay relative to the HTML file instead of resolving from filesystem root.
  base: DESKTOP_ASSET_BASE,
  // Temporary workaround for Lightning CSS 1.32.0 false-positive
  // ::highlight(...) warnings until the upstream fix is released through Vite.
  customLogger: createOpenForgeViteLogger(),
  plugins: [
    createOpenForgeHostRuntimeImportMapPlugin(),
    createOpenForgeHostRuntimeSvelteDevExternalPlugin(),
    tailwindcss(),
    svelte(),
  ],
  resolve: {
    alias: createOpenForgeRootAliases(),
  },
  // Keep Svelte out of dep pre-bundling so dev serve never creates a second Svelte
  // copy under `.vite/deps`. Combined with the resolveId rewrite above, EVERY Svelte
  // import — host modules AND pre-bundled deps that import Svelte (e.g. @lucide/svelte)
  // — resolves to the shared `plugin://host-runtime/svelte` instance instead.
  optimizeDeps: {
    exclude: [...OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS],
  },
  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fsEvents doesn't work on all systems
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari14'],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Raise the limit to suppress two known-large-but-unavoidable chunks:
    //   - vendor-diff  (~1,086 kB): @git-diff-view/lowlight bundles all
    //     highlight.js language grammars — no meaningful split possible.
    //   - diffWorker   (~960 kB):   same lowlight dep in the Web Worker.
    // Tauri loads assets from disk — no network transfer cost, so these
    // sizes are not a real perf problem, only a bundler noise warning.
    chunkSizeWarningLimit: OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT,
    rolldownOptions: {
      // Share ONE Svelte instance between the host renderer and external plugins so
      // mounting a plugin component from the host tree does not throw effect_orphan — see
      // isOpenForgeHostRuntimeSvelteExternal in svelteHostRuntimeContract.mjs. NOTE: this
      // only affects `vite build` (packaged app), not `vite` dev serve (electron:dev).
      external: isOpenForgeHostRuntimeSvelteExternal,
      output: {
        codeSplitting: {
          groups: createOpenForgeChunkGroups(),
        },
      },
    },
  },
})
