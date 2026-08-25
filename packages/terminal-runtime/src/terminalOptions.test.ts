import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_FONT_SIZE,
  TERMINAL_WEB_FONT_FACES,
  preloadTerminalFonts,
} from './terminalOptions'

describe('terminal font preloading', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports when every bundled terminal font is ready', async () => {
    const load = vi.fn().mockResolvedValue([{} as FontFace])
    vi.stubGlobal('document', { fonts: { load } })

    await expect(preloadTerminalFonts()).resolves.toEqual({ status: 'ready' })
    expect(load).toHaveBeenCalledTimes(TERMINAL_WEB_FONT_FACES.length)
    expect(load).toHaveBeenCalledWith(`400 ${TERMINAL_FONT_SIZE}px "JetBrains Mono"`)
    expect(load).toHaveBeenCalledWith(`italic 700 ${TERMINAL_FONT_SIZE}px "JetBrains Mono"`)
    expect(load).toHaveBeenCalledWith(`400 ${TERMINAL_FONT_SIZE}px "NerdFontsSymbols Nerd Font"`)
  })

  it('reports a rejected bundled terminal font load', async () => {
    const loadError = new Error('font request failed')
    const load = vi.fn().mockRejectedValue(loadError)
    vi.stubGlobal('document', { fonts: { load } })

    await expect(preloadTerminalFonts()).resolves.toEqual({
      status: 'failed',
      error: loadError,
    })
  })

  it('reports a timeout and exposes when delayed bundled fonts become ready', async () => {
    vi.useFakeTimers()
    let resolveLoad!: (faces: FontFace[]) => void
    const delayedLoad = new Promise<FontFace[]>(resolve => {
      resolveLoad = resolve
    })
    const load = vi.fn().mockReturnValue(delayedLoad)
    vi.stubGlobal('document', { fonts: { load } })

    const preloading = preloadTerminalFonts()
    await vi.advanceTimersByTimeAsync(3000)
    const result = await preloading

    expect(result.status).toBe('timed-out')
    if (result.status !== 'timed-out') throw new Error('Expected terminal font loading to time out')

    resolveLoad([{} as FontFace])
    await expect(result.completion).resolves.toEqual({ status: 'ready' })
  })
})
