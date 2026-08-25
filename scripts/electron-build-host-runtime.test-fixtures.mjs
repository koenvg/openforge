import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { svelteHostRuntimeBuildEntries } from '../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
import { BACKEND_LAYOUT_CONFIG_FILE } from './rust-sidecar-layout.mjs'

export async function writeMinimalHostRuntimeInputs(root, { backendCrateRoot = 'src-tauri' } = {}) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, BACKEND_LAYOUT_CONFIG_FILE), JSON.stringify({
    backendCrateRoot,
    manifestPath: `${backendCrateRoot}/Cargo.toml`,
    binaryName: backendCrateRoot === 'src-tauri' ? 'openforge' : 'openforge-backend',
    iconPath: `${backendCrateRoot}/icons/icon.icns`,
    electronBundleRoot: `${backendCrateRoot}/target/release/bundle/electron/macos`,
  }))
  await mkdir(join(root, 'packages', 'plugin-sdk', 'src'), { recursive: true })
  await mkdir(join(root, 'packages', 'plugin-runtime', 'src'), { recursive: true })
  await mkdir(join(root, 'packages', 'terminal-runtime', 'src'), { recursive: true })
  await mkdir(join(root, backendCrateRoot, 'plugin-host'), { recursive: true })
  await writeFile(join(root, 'packages', 'plugin-sdk', 'src', 'index.ts'), 'export const pluginSdk = true; export function resolveExternalTextFileChunkSize() { return 2048; }')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'index.ts'), 'export const terminalRuntime = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'terminalRuntime.ts'), 'export const terminalRuntimeCore = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'terminalOptions.ts'), 'export const terminalOptions = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'theme.ts'), 'export const terminalTheme = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'terminalShortcuts.ts'), 'export const terminalShortcuts = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'terminalShortcutController.ts'), 'export const terminalShortcutController = true;')
  await writeFile(join(root, 'packages', 'terminal-runtime', 'src', 'TerminalTabsShell.svelte'), '<script>export const terminalTabsShell = true;</script>')
  await writeFile(join(root, 'packages', 'plugin-runtime', 'src', 'commandValidation.ts'), 'export function validateSchemaValue() { return { valid: true, bundledRuntimeMarker: true }; }')
  await writeFile(join(root, backendCrateRoot, 'plugin-host', 'index.ts'), "import { resolveExternalTextFileChunkSize } from '@openforge-app/plugin-sdk'\nimport { validateSchemaValue } from '@openforge-app/plugin-runtime/commandValidation'\nconsole.log({ validation: validateSchemaValue(), chunkSize: resolveExternalTextFileChunkSize() })\n")

  const svelteFiles = Object.fromEntries(
    Object.values(svelteHostRuntimeBuildEntries()).map(relPath => [relPath, `export const stub = ${JSON.stringify(`svelte:${relPath}`)};`]),
  )
  for (const [relPath, content] of Object.entries(svelteFiles)) {
    const filePath = join(root, 'node_modules', 'svelte', 'src', relPath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
}
