import { describe, expect, it, vi } from 'vitest'
import { createTerminalLinkHandler } from './terminalLinks'

describe('terminal links', () => {
  it('blocks non-HTTP protocols and delegates activation through the adapter options', () => {
    const options = { openLink: vi.fn(async () => undefined) }
    const handler = createTerminalLinkHandler(options)
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    handler.activate(event, 'https://openforge.dev/docs', undefined as never)

    expect(handler.allowNonHttpProtocols).toBe(false)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(options.openLink).toHaveBeenCalledWith('https://openforge.dev/docs')
  })
})
