import { describe, expect, it, vi } from 'vitest'
import { createTerminalLinkHandler } from './terminalLinks'
import type { TerminalRuntimeHost } from './terminalRuntimeTypes'

function createHost(): TerminalRuntimeHost {
  return {
    openLink: vi.fn(async () => undefined),
  } as unknown as TerminalRuntimeHost
}

describe('terminal links', () => {
  it('blocks non-HTTP protocols and delegates activation with the Terminal Surface key', () => {
    const host = createHost()
    const handler = createTerminalLinkHandler(host, 'T-1-shell-2')
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    handler.activate(event, 'https://openforge.dev/docs', undefined as never)

    expect(handler.allowNonHttpProtocols).toBe(false)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(host.openLink).toHaveBeenCalledWith('T-1-shell-2', 'https://openforge.dev/docs')
  })
})
