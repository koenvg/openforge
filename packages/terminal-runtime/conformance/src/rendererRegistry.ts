import type { TerminalView, TerminalViewFactoryOptions } from '../../src/terminalView'
import { createXtermTerminalView } from '../../src/xtermTerminalView'

export interface TerminalConformanceRenderer {
  readonly id: string
  createView(options: TerminalViewFactoryOptions): TerminalView
}

const renderers: Record<string, TerminalConformanceRenderer> = {
  xterm: {
    id: 'xterm',
    createView: createXtermTerminalView,
  },
}

export function getTerminalConformanceRenderer(id: string): TerminalConformanceRenderer {
  const renderer = renderers[id]
  if (!renderer) throw new Error(`Unknown terminal conformance renderer: ${id}`)
  return renderer
}
