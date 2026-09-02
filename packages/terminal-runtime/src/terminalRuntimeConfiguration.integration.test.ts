import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'
import type { TerminalViewFactory, TerminalViewFactoryOptions } from './terminalView'
import type { TerminalThemeSnapshot, ThemeMode } from './theme'

describe('Terminal Session configuration', () => {
  it('samples host configuration once for each new Terminal Session', async () => {
    const host = createHost()
    const sampledKeys: string[] = []
    host.environment.sampleSessionConfiguration = (shellSessionKey) => {
      sampledKeys.push(shellSessionKey)
      return { renderer: 'xterm', enableImages: shellSessionKey === 'T-2' }
    }
    const viewOptions: TerminalViewFactoryOptions[] = []
    const runtime = createTerminalRuntime({ ...host, createTerminalView: vi.fn((options) => {
      viewOptions.push(options)
      return createFakeTerminalView()
    }), })

    await runtime.acquire('T-1')
    await runtime.acquire('T-1')
    await runtime.acquire('T-2')

    expect(sampledKeys).toEqual(['T-1', 'T-2'])
    expect(viewOptions.map(options => options.enableImages)).toEqual([false, true])
  })

  it('keeps the required themeMode factory option for legacy custom views', async () => {
    const host = createHost()
    const seenThemeModes: ThemeMode[] = []
    const legacyFactory: TerminalViewFactory = (options: { themeMode: ThemeMode }) => {
      seenThemeModes.push(options.themeMode)
      return createFakeTerminalView()
    }
    const runtime = createTerminalRuntime({ ...host, createTerminalView: legacyFactory })

    await runtime.acquire('T-legacy-themed-shell')

    expect(seenThemeModes).toEqual(['dark'])
    runtime.dispose()
  })

  it('applies host presentation snapshots reactively without recreating the terminal view', async () => {
    const light: TerminalThemeSnapshot = {
      appearance: 'light',
      terminalTheme: {
        background: '#ffffff', foreground: '#111111', cursor: '#0000ff', cursorAccent: '#ffffff',
        selectionBackground: '#ccddee', selectionForeground: '#111111',
        black: '#000000', red: '#cc0000', green: '#00aa00', yellow: '#aa7700',
        blue: '#0000cc', magenta: '#aa00aa', cyan: '#008899', white: '#dddddd',
        brightBlack: '#555555', brightRed: '#ff2222', brightGreen: '#22cc22', brightYellow: '#ddaa22',
        brightBlue: '#2222ff', brightMagenta: '#cc22cc', brightCyan: '#22bbbb', brightWhite: '#ffffff',
      },
    }
    const dark: TerminalThemeSnapshot = {
      appearance: 'dark',
      terminalTheme: {
        ...light.terminalTheme,
        background: '#101216',
        foreground: '#f5f7fa',
        red: '#ff7788',
        brightRed: '#ff99aa',
      },
    }
    const themePresentation = writable(light)
    const host = createHost()
    host.environment.themeMode = undefined
    host.environment.themePresentation = themePresentation
    const view = createFakeTerminalView()
    const createTerminalView = vi.fn((options: TerminalViewFactoryOptions) => {
      expect(options.appearance).toBe('light')
      expect(options.theme).toEqual(light.terminalTheme)
      return view
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView })

    await runtime.acquire('T-themed-shell-0')
    themePresentation.set(dark)

    expect(createTerminalView).toHaveBeenCalledTimes(1)
    expect(view.setTheme).toHaveBeenCalledWith(dark.terminalTheme)
    expect(dark.terminalTheme.red).toBe('#ff7788')
    runtime.dispose()
  })
})
