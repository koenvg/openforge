import { getContext, setContext } from 'svelte'
import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'

interface TerminalSurfaceContext {
  adapter: TerminalSurfaceAdapter
  showShellReadyAffordance: boolean
}

const TERMINAL_SURFACE_CONTEXT = Symbol('terminal-surface-context')

export function provideTerminalSurfaceContext(context: TerminalSurfaceContext): void {
  setContext(TERMINAL_SURFACE_CONTEXT, context)
}

export function useTerminalSurfaceContext(): TerminalSurfaceContext {
  const context = getContext<TerminalSurfaceContext | undefined>(TERMINAL_SURFACE_CONTEXT)
  if (!context) throw new Error('Terminal Surface context is unavailable')
  return context
}
