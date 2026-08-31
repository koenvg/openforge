import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalPerformanceTrace,
  TERMINAL_PERFORMANCE_PHASES,
} from './terminalPerformanceTrace'

describe('terminal performance trace', () => {
  it('does not read the clock or retain marks while inactive', () => {
    const now = vi.fn(() => {
      throw new Error('inactive trace read the clock')
    })
    const trace = createTerminalPerformanceTrace({ now })

    trace.mark('terminalAttachment', { terminalKey: 'T-1-shell-0' })
    trace.recordWrite({ terminalKey: 'T-1-shell-0', ptyInstanceId: 7, writeGeneration: 1 })

    expect(now).not.toHaveBeenCalled()
    expect(trace.snapshot()).toBeNull()
  })

  it('records the first applicable ordered marks and returns serializable evidence', () => {
    let timestamp = 10
    const trace = createTerminalPerformanceTrace({ now: () => timestamp++ })

    trace.start()
    trace.mark('terminalAttachment', { terminalKey: 'T-1-shell-0' })
    trace.mark('terminalAttachment', { terminalKey: 'T-1-shell-0' })
    trace.mark('xtermMount', { terminalKey: 'T-1-shell-0' })
    trace.mark('shellSpawnRequest', { terminalKey: 'T-1-shell-0' })
    trace.mark('ptyCreation', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })
    trace.mark('firstOutput', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })
    trace.mark('inputAcceptance', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })
    trace.mark('firstOutput', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })
    trace.mark('modelPublication', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })
    trace.recordWrite({ terminalKey: 'T-1-shell-0', ptyInstanceId: 7, writeGeneration: 4 })
    trace.mark('xtermParse', { terminalKey: 'T-1-shell-0', writeGeneration: 4 })
    trace.mark('renderCallback', { terminalKey: 'T-1-shell-0', writeGeneration: 4 })
    trace.mark('presentationProof', { terminalKey: 'T-1-shell-0', writeGeneration: 4 })

    const snapshot = trace.finish()
    expect(snapshot).toEqual({
      clockDomain: 'renderer-performance',
      terminalKey: 'T-1-shell-0',
      ptyInstanceId: 7,
      timestamps: Object.fromEntries(TERMINAL_PERFORMANCE_PHASES.map((phase, index) => [phase, 10 + index])),
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(trace.snapshot()).toEqual(snapshot)
  })

  it('rejects unrelated terminals, stale PTY instances, and stale write generations', () => {
    let timestamp = 1
    const trace = createTerminalPerformanceTrace({ now: () => timestamp++ })
    trace.start()
    trace.mark('terminalAttachment', { terminalKey: 'T-1' })
    trace.mark('xtermMount', { terminalKey: 'T-1' })
    trace.mark('terminalAttachment', { terminalKey: 'T-1-shell-0' })
    trace.mark('xtermMount', { terminalKey: 'T-2-shell-0' })
    trace.mark('xtermMount', { terminalKey: 'T-1-shell-0' })
    trace.mark('shellSpawnRequest', { terminalKey: 'T-1-shell-0' })
    trace.mark('ptyCreation', { terminalKey: 'T-1-shell-0', ptyInstanceId: 9 })
    trace.mark('inputAcceptance', { terminalKey: 'T-1-shell-0', ptyInstanceId: 8 })
    trace.mark('inputAcceptance', { terminalKey: 'T-1-shell-0', ptyInstanceId: 9 })
    trace.mark('firstOutput', { terminalKey: 'T-1-shell-0', ptyInstanceId: 8 })
    trace.mark('firstOutput', { terminalKey: 'T-1-shell-0', ptyInstanceId: 9 })
    trace.mark('modelPublication', { terminalKey: 'T-1-shell-0', ptyInstanceId: 9 })
    trace.recordWrite({ terminalKey: 'T-1-shell-0', ptyInstanceId: 8, writeGeneration: 3 })
    trace.recordWrite({ terminalKey: 'T-1-shell-0', ptyInstanceId: 9, writeGeneration: 5 })
    trace.mark('xtermParse', { terminalKey: 'T-1-shell-0', writeGeneration: 4 })
    trace.mark('xtermParse', { terminalKey: 'T-1-shell-0', writeGeneration: 5 })

    const snapshot = trace.snapshot()
    expect(snapshot?.timestamps.xtermMount).toBe(3)
    expect(snapshot?.timestamps.inputAcceptance).toBe(6)
    expect(snapshot?.timestamps.firstOutput).toBe(7)
    expect(snapshot?.timestamps.xtermParse).toBe(9)
  })
})
