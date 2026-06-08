import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const defaultWorkspaceRoot = path.resolve(import.meta.dirname, '..')
const GENERATED_BANNER = '/* Generated host-shared @openforge/terminal-runtime asset. Do not edit. */'

export async function buildTerminalRuntime(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : defaultWorkspaceRoot
  const outDir = options.outDir
    ? path.resolve(options.outDir)
    : path.join(workspaceRoot, 'dist-electron/plugin-host/terminal-runtime')

  await build({
    configFile: false,
    root: workspaceRoot,
    publicDir: false,
    logLevel: options.logLevel ?? 'info',
    resolve: {
      alias: {
        '@openforge/terminal-runtime': path.join(workspaceRoot, 'packages/terminal-runtime/src/index.ts'),
      },
    },
    build: {
      emptyOutDir: true,
      lib: {
        entry: {
          index: path.join(workspaceRoot, 'packages/terminal-runtime/src/index.ts'),
          terminalRuntime: path.join(workspaceRoot, 'packages/terminal-runtime/src/terminalRuntime.ts'),
          terminalOptions: path.join(workspaceRoot, 'packages/terminal-runtime/src/terminalOptions.ts'),
          theme: path.join(workspaceRoot, 'packages/terminal-runtime/src/theme.ts'),
          shortcuts: path.join(workspaceRoot, 'packages/terminal-runtime/src/terminalShortcuts.ts'),
          shortcutController: path.join(workspaceRoot, 'packages/terminal-runtime/src/terminalShortcutController.ts'),
        },
        formats: ['es'],
      },
      minify: false,
      outDir,
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        external: id => id === 'svelte' || id.startsWith('svelte/'),
        output: {
          banner: GENERATED_BANNER,
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  })

  return path.join(outDir, 'index.js')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildTerminalRuntime()
}
