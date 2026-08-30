import { describe, expect, it } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const READY_FONT_READINESS = { status: 'ready' } as const

describe('xterm terminal state replacement', () => {
  it('discards output still queued when an authoritative snapshot replaces terminal state', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'T-replacement-shell-0',
      themeMode: 'dark',
      openLink: async () => undefined,
      fontReadiness: READY_FONT_READINESS,
      enableImages: false,
    })

    try {
      view.bootstrap('stale queued output\r\n', 7, 1)

      await view.replaceSnapshot({
        data: 'authoritative output',
        ptyInstanceId: 7,
        sequence: 2,
      })

      expect(view.capturePresentation().lines.map(line => line.text)).toEqual([
        'authoritative output',
      ])
    } finally {
      view.dispose()
    }
  })
})
