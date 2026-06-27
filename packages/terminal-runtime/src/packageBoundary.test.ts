import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function listRuntimeSources(dir = join(process.cwd(), 'packages/terminal-runtime/src')): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) return listRuntimeSources(fullPath)
    return /\.(svelte|ts)$/.test(entry) && !entry.endsWith('.test.ts') ? [fullPath] : []
  })
}

describe('@openforge/terminal-runtime package boundary', () => {
  it('does not import app renderer, Electron, preload, Rust, plugin-private IPC, or host internals', () => {
    const forbiddenImportPatterns = [
      /from ['"](?:\.\.\/){2,}src\//,
      /from ['"](?:\.\.\/){2,}plugins\//,
      /from ['"].*\/ipc['"]/, 
      /from ['"].*\/desktopIpc['"]/, 
      /from ['"]electron['"]/, 
      /from ['"].*src-tauri/,
      /from ['"].*src\/electron/,
    ]

    for (const sourcePath of listRuntimeSources()) {
      const source = readFileSync(sourcePath, 'utf8')
      for (const pattern of forbiddenImportPatterns) {
        expect(source, `${sourcePath} should not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps Svelte as a host-shared peer dependency', async () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'packages/terminal-runtime/package.json'), 'utf8'))

    expect(packageJson.peerDependencies.svelte).toBe('^5.0.0')
    expect(packageJson.dependencies?.svelte).toBeUndefined()
    expect(packageJson.exports['./shortcuts']).toBe('./src/terminalShortcuts.ts')
    expect(packageJson.exports['./shortcutController']).toBe('./src/terminalShortcutController.ts')
    expect(packageJson.exports['./TerminalTabsShell']).toBe('./src/TerminalTabsShell.svelte')
    expect(packageJson.exports['./xterm.css']).toBe('./src/xterm.css')
  })
})
