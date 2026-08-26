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

describe('@openforge-app/terminal-runtime package boundary', () => {
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

  it('keeps xterm rendering and addon setup outside the runtime lifecycle module', () => {
    const runtimeSource = readFileSync(join(process.cwd(), 'packages/terminal-runtime/src/terminalRuntime.ts'), 'utf8')

    expect(runtimeSource).not.toMatch(/from ['"]@xterm\/addon-/)
    expect(runtimeSource).not.toContain('new Terminal(')
    expect(runtimeSource).not.toContain('new ResizeObserver(')
    expect(runtimeSource).not.toContain('new IntersectionObserver(')
  })

  it('keeps lower-level event names and Rust payload fields out of Terminal Runtime', () => {
    const runtimeFiles = [
      'terminalRuntime.ts',
      'terminalAcquisition.ts',
      'terminalStateView.ts',
      'terminalReconnectReplay.ts',
    ]

    for (const fileName of runtimeFiles) {
      const source = readFileSync(join(process.cwd(), 'packages/terminal-runtime/src', fileName), 'utf8')
      expect(source, fileName).not.toContain('pty-output-')
      expect(source, fileName).not.toContain('pty-exit-')
      expect(source, fileName).not.toContain('openforge-app-events-reconnected')
      expect(source, fileName).not.toContain('instance_id')
    }
  })

  it('keeps xterm types behind the TerminalView adapter', () => {
    const rendererNeutralSources = [
      'terminalRuntimeTypes.ts',
      'terminalRuntime.ts',
      'terminalTransport.ts',
      'terminalSessionService.ts',
      'terminalAcquisition.ts',
      'terminalAttachment.ts',
      'terminalStateView.ts',
      'terminalReconnectReplay.ts',
      'terminalControls.ts',
      'terminalSessionLifecycle.ts',
      'terminalThemePropagation.ts',
    ]

    for (const fileName of rendererNeutralSources) {
      const source = readFileSync(
        join(process.cwd(), 'packages/terminal-runtime/src', fileName),
        'utf8',
      )
      expect(source, `${fileName} should depend on TerminalView instead of xterm`).not.toMatch(
        /from ['"]@xterm\//,
      )
    }
  })

  it('keeps the shared TerminalView test factory free of global mock installation', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/terminal-runtime/src/terminalView.testUtils.ts'),
      'utf8',
    )

    expect(source).not.toContain('vi.mock(')
    expect(source).not.toMatch(/from ['"]@xterm\//)
    expect(source).not.toContain('terminalRuntimeFeatures.testSupport')
    expect(source).not.toContain('terminalRuntimeXtermMocks.testSupport')
  })

  it('keeps diff theming out of the public terminal runtime contract', async () => {
    const [runtimeExports, themeExports] = await Promise.all([
      import('@openforge-app/terminal-runtime'),
      import('@openforge-app/terminal-runtime/theme'),
    ])

    expect(runtimeExports).not.toHaveProperty('getDiffTheme')
    expect(themeExports).not.toHaveProperty('getDiffTheme')
  })

  it('keeps DOM theme synchronization out of the public terminal runtime contract', async () => {
    const [runtimeExports, themeExports] = await Promise.all([
      import('@openforge-app/terminal-runtime'),
      import('@openforge-app/terminal-runtime/theme'),
    ])

    for (const exports of [runtimeExports, themeExports]) {
      expect(exports).not.toHaveProperty('setupHostThemeSync')
      expect(exports).not.toHaveProperty('syncThemeModeWithDocument')
    }
  })

  it('keeps Svelte as a host-shared peer dependency', async () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'packages/terminal-runtime/package.json'), 'utf8'))

    expect(packageJson.peerDependencies.svelte).toBe('^5.0.0')
    expect(packageJson.dependencies?.svelte).toBeUndefined()
    expect(packageJson.exports['./terminalTransport']).toBe('./src/terminalTransport.ts')
    expect(packageJson.exports['./shortcuts']).toBe('./src/terminalShortcuts.ts')
    expect(packageJson.exports['./shortcutController']).toBe('./src/terminalShortcutController.ts')
    expect(packageJson.exports['./taskTerminalController']).toBe('./src/taskTerminalController.ts')
    expect(packageJson.exports['./testUtils']).toBe('./src/terminalView.testUtils.ts')
    expect(packageJson.exports['./TerminalTabsShell']).toBe('./src/TerminalTabsShell.svelte')
    expect(packageJson.exports['./xterm.css']).toBe('./src/xterm.css')
  })

  it('ships the current Nerd Font symbols through the public xterm stylesheet', () => {
    const packageRoot = join(process.cwd(), 'packages/terminal-runtime')
    const xtermCss = readFileSync(join(packageRoot, 'src/xterm.css'), 'utf8')
    const symbolsFontPath = join(packageRoot, 'src/fonts/SymbolsNerdFontMono-Regular.woff2')

    expect(xtermCss).toContain("font-family: 'Symbols Nerd Font Mono'")
    expect(xtermCss).toContain("url('./fonts/SymbolsNerdFontMono-Regular.woff2')")
    expect(statSync(symbolsFontPath).isFile()).toBe(true)
  })
})
