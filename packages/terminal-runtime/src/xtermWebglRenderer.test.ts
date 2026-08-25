import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createXtermWebglRendererLifecycle } from './xtermWebglRenderer'

const mocks = vi.hoisted(() => ({
  contextLossCallbacks: [] as Array<() => void>,
  contextLossDisposable: { dispose: vi.fn() },
  webglAddon: { dispose: vi.fn(), onContextLoss: vi.fn() },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    mocks.webglAddon.onContextLoss.mockImplementation((callback: () => void) => {
      mocks.contextLossCallbacks.push(callback)
      return mocks.contextLossDisposable
    })
    return mocks.webglAddon
  }),
}))

describe('xterm WebGL renderer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contextLossCallbacks.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads WebGL once and disposes its listener and addon', () => {
    const terminal = { loadAddon: vi.fn() } as unknown as Terminal
    const lifecycle = createXtermWebglRendererLifecycle({
      terminal,
      onFailure: vi.fn(),
      refreshAfterFallback: vi.fn(),
    })

    expect(lifecycle.rendererName).toBe('xterm-default')
    lifecycle.load()
    lifecycle.load()
    expect(lifecycle.rendererName).toBe('xterm-webgl')

    lifecycle.dispose()
    lifecycle.dispose()

    expect(terminal.loadAddon).toHaveBeenCalledOnce()
    expect(mocks.contextLossDisposable.dispose).toHaveBeenCalledOnce()
    expect(mocks.webglAddon.dispose).toHaveBeenCalledOnce()
    expect(lifecycle.rendererName).toBe('xterm-default')
  })

  it('falls back and reports a lost WebGL context', () => {
    const onFailure = vi.fn()
    const refreshAfterFallback = vi.fn()
    const lifecycle = createXtermWebglRendererLifecycle({
      terminal: { loadAddon: vi.fn() } as unknown as Terminal,
      onFailure,
      refreshAfterFallback,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    lifecycle.load()
    mocks.contextLossCallbacks[0]?.()

    expect(lifecycle.rendererName).toBe('xterm-default')
    expect(onFailure).toHaveBeenCalledWith({ renderer: 'webgl', reason: 'context-lost' })
    expect(refreshAfterFallback).toHaveBeenCalledOnce()
    expect(mocks.contextLossDisposable.dispose).toHaveBeenCalledOnce()
    expect(mocks.webglAddon.dispose).toHaveBeenCalledOnce()
  })

  it('reports an unavailable renderer and does not retry it', () => {
    const loadError = new Error('WebGL unavailable')
    const terminal = { loadAddon: vi.fn(() => { throw loadError }) } as unknown as Terminal
    const onFailure = vi.fn()
    const lifecycle = createXtermWebglRendererLifecycle({
      terminal,
      loggerName: 'terminal-test',
      onFailure,
      refreshAfterFallback: vi.fn(),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => lifecycle.load()).not.toThrow()
    lifecycle.load()

    expect(terminal.loadAddon).toHaveBeenCalledOnce()
    expect(lifecycle.rendererName).toBe('xterm-default')
    expect(onFailure).toHaveBeenCalledWith({ renderer: 'webgl', reason: 'unavailable', error: loadError })
    expect(mocks.contextLossDisposable.dispose).toHaveBeenCalledOnce()
    expect(mocks.webglAddon.dispose).toHaveBeenCalledOnce()
  })
})
