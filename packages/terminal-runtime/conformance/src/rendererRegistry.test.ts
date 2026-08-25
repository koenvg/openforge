import { describe, expect, it } from 'vitest'
import { getTerminalConformanceRenderer } from './rendererRegistry'

describe('terminal conformance renderer registry', () => {
  it('selects renderers through a TerminalView factory instead of coupling scenarios to xterm', () => {
    expect(getTerminalConformanceRenderer('xterm')).toMatchObject({ id: 'xterm' })
    expect(() => getTerminalConformanceRenderer('wterm')).toThrow('Unknown terminal conformance renderer: wterm')
  })
})
