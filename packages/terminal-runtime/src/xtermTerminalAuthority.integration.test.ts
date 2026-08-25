import { describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

describe('xterm terminal authority adapter', () => {
  it('keeps a split terminal query on its PTY instance and emits one response', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'T-partial-shell-0',
      themeMode: 'dark',
      openLink: async () => undefined,
      enableImages: false,
      fontReadiness: { status: 'ready' },
    })
    const responses: Array<{ data: string; ptyInstanceId: number | null }> = []
    view.onQueryResponse(response => responses.push(response))

    view.bootstrap('\u001b[', 71)
    view.writeLive({ data: '6n', ptyInstanceId: 71 })

    await vi.waitFor(() => {
      expect(responses).toEqual([{ data: '\u001b[1;1R', ptyInstanceId: 71 }])
    })
    view.dispose()
  })
})
