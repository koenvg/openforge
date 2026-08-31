import { describe, expect, it, vi } from 'vitest'
import { openUrl, writePty } from './ipc'
import { agentTerminalSessions } from './terminalSessionService'
import {
  getLoadedAddonNamesAt,
  getTerminalMockAt,
  getTerminalMocksAt,
  getWebLinksHandler,
  webLinksHandler,
} from './terminalSessionService.testSetup'

const { acquire, beginPtySpawn, restorePtyInstance } = agentTerminalSessions

describe('desktop Terminal Session input', () => {
  it('opens detected Agent Terminal Surface links externally', async () => {
    const session = await acquire('T-42')
    const { loadAddon } = getTerminalMocksAt(0)
    const event = new MouseEvent('click')
    const preventDefault = vi.spyOn(event, 'preventDefault')
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    const spawnLease = beginPtySpawn(session)

    expect(getLoadedAddonNamesAt(0).slice(0, 2)).toEqual(['FitAddon', 'WebLinksAddon'])
    expect(spawnLease?.imageProtocol).toBe('iterm2')
    spawnLease?.cancel()
    expect(loadAddon).toHaveBeenCalledTimes(4)
    expect(webLinksHandler).not.toBeNull()

    getWebLinksHandler()(event, 'https://example.com/pool')

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('https://example.com/pool')
  })

  it('opens OSC 8 Agent Terminal Surface links instead of xterm default browser handling', async () => {
    await acquire('T-43')
    const event = new MouseEvent('click')
    const preventDefault = vi.spyOn(event, 'preventDefault')
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    getTerminalMockAt(0).options.linkHandler?.activate(
      event,
      'https://example.com/osc8',
      { start: { x: 1, y: 1 }, end: { x: 10, y: 1 } },
    )

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(openUrl).toHaveBeenCalledWith('https://example.com/osc8')
  })

  it('agent terminals suppress Shift+Enter and send Ctrl+J only while the PTY is active', async () => {
    await acquire('T-120')
    await acquire('T-120-shell-0')
    const { attachCustomKeyEventHandler: agentKeyHandlerSpy } = getTerminalMocksAt(0)
    const { attachCustomKeyEventHandler: shellKeyHandlerSpy } = getTerminalMocksAt(1)

    expect(shellKeyHandlerSpy).not.toHaveBeenCalled()
    expect(agentKeyHandlerSpy).toHaveBeenCalledTimes(1)
    const handleKeyEvent = agentKeyHandlerSpy.mock.calls[0][0]

    const inactiveEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })
    expect(handleKeyEvent(inactiveEvent)).toBe(false)
    expect(inactiveEvent.defaultPrevented).toBe(true)
    expect(writePty).not.toHaveBeenCalled()

    await restorePtyInstance('T-120', 7)
    const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })
    const keypressEvent = new KeyboardEvent('keypress', { key: 'Enter', shiftKey: true, cancelable: true })
    const keydownStopPropagation = vi.spyOn(keydownEvent, 'stopPropagation')
    const keypressStopPropagation = vi.spyOn(keypressEvent, 'stopPropagation')

    expect(handleKeyEvent(keydownEvent)).toBe(false)
    expect(handleKeyEvent(keypressEvent)).toBe(false)
    expect(keydownEvent.defaultPrevented).toBe(true)
    expect(keypressEvent.defaultPrevented).toBe(true)
    expect(keydownStopPropagation).toHaveBeenCalledOnce()
    expect(keypressStopPropagation).toHaveBeenCalledOnce()
    expect(writePty).toHaveBeenCalledOnce()
    expect(writePty).toHaveBeenCalledWith('T-120', '\n')
  })
})
