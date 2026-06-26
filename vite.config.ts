import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { rendererImportMapHtml } from './packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
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
    {
      find: /^@openforge\/plugin-sdk$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/index.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/backend$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/backend.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/domain$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/domain.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/prStatusPresentation$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/prStatusPresentation.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/frontend$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/frontend.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/markdown$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/markdown.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/numberParsing$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/numberParsing.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/package-metadata-schema\.json$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/openforgePackageMetadataSchema.json'),
    },
    {
      find: /^@openforge\/plugin-sdk\/sanitize$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/sanitize.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/testing$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/testing.ts'),
    },
    {
      find: /^@openforge\/plugin-sdk\/ui\/MarkdownContent\.svelte$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/ui/MarkdownContent.svelte'),
    },
    {
      find: /^@openforge\/plugin-sdk\/ui\/ResizablePanel\.svelte$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/ui/ResizablePanel.svelte'),
    },
    {
      find: /^@openforge\/plugin-sdk\/vite$/,
      replacement: resolve(process.cwd(), 'packages/plugin-sdk/src/vite.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/index.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/terminalRuntime$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalRuntime.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/terminalOptions$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalOptions.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/theme$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/theme.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/shortcuts$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalShortcuts.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/shortcutController$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/terminalShortcutController.ts'),
    },
    {
      find: /^@openforge\/terminal-runtime\/TerminalTabsShell$/,
      replacement: resolve(process.cwd(), 'packages/terminal-runtime/src/TerminalTabsShell.svelte'),
    },
    {
      find: /^@openforge\/terminal-runtime\/xterm\.css$/,
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
      output: {
        codeSplitting: {
          groups: createOpenForgeChunkGroups(),
        },
      },
    },
  },
})
