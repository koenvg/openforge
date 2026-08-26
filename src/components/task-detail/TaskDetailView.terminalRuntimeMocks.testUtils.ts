import { vi } from 'vitest'

// Mock xterm.js with a minimal Terminal stub.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    loadAddon = vi.fn()
    refresh = vi.fn()
    focus = vi.fn()
    reset = vi.fn()
    cols = 80
    rows = 24
    options: { theme: Record<string, string> } = { theme: {} }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
    proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 })
  }
  return { FitAddon }
})

vi.mock('@xterm/addon-web-links', () => {
  class WebLinksAddon {}
  return { WebLinksAddon }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

const mockRunAppCommandInTaskTerminal = vi.hoisted(() => vi.fn(async () => true))

vi.mock('../../lib/runAppCommand', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/runAppCommand')>()
  return {
    ...actual,
    runAppCommandInTaskTerminal: mockRunAppCommandInTaskTerminal,
  }
})

export { mockRunAppCommandInTaskTerminal }
