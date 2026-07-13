import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { isOpenForgeHostRuntimeSvelteExternal, rendererImportMapHtml } from './packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
import { createOpenForgePluginSdkSourceAliases } from './packages/plugin-sdk/src/vite'
import { createDaisyUiTailwindPluginAliases } from './src/lib/viteDaisyUi'
import { createOpenForgeChunkGroups, OPEN_FORGE_CHUNK_SIZE_WARNING_LIMIT } from './src/lib/viteChunks'
import { createOpenForgeViteLogger } from './src/lib/viteLogger'
import { DESKTOP_ASSET_BASE } from './src/lib/viteDesktopBuild'

function createOpenForgeHostRuntimeImportMapPlugin() {
  return {
    name: 'openforge-host-runtime-import-map',
    transformIndexHtml(html: string) {
      return html.replace('<!-- openforge-host-runtime-importmap -->', rendererImportMapHtml())
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
      find: /^@openforge-app\/terminal-runtime\/xterm\.css$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/xterm.css'),
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
  plugins: [createOpenForgeHostRuntimeImportMapPlugin(), tailwindcss(), svelte()],
  resolve: {
    alias: createOpenForgeRootAliases(),
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
