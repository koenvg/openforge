import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'
import { terminalLogMessage } from './terminalLogging'
import type { TerminalViewRendererFailure } from './terminalView'

export interface XtermWebglRendererOptions {
  terminal: Terminal
  loggerName?: string
  onFailure(failure: TerminalViewRendererFailure): void
  refreshAfterFallback(): void
}

export interface XtermWebglRendererLifecycle {
  readonly rendererName: 'xterm-default' | 'xterm-webgl'
  load(): void
  dispose(): void
}

export function createXtermWebglRendererLifecycle(
  { terminal, loggerName, onFailure, refreshAfterFallback }: XtermWebglRendererOptions,
): XtermWebglRendererLifecycle {
  let addon: WebglAddon | null = null
  let contextLossDisposable: { dispose(): void } | null = null
  let unavailable = false
  let disposed = false

  function disposeRenderer(): void {
    const currentAddon = addon
    addon = null
    try {
      contextLossDisposable?.dispose()
    } catch (error) {
      console.warn(terminalLogMessage(loggerName, 'Failed to dispose WebGL context loss listener:'), error)
    } finally {
      contextLossDisposable = null
    }
    try {
      currentAddon?.dispose()
    } catch (error) {
      console.warn(terminalLogMessage(loggerName, 'Failed to dispose WebGL renderer addon:'), error)
    }
  }

  return {
    get rendererName() {
      return addon ? 'xterm-webgl' : 'xterm-default'
    },
    load() {
      if (addon || unavailable || disposed) return

      let candidate: WebglAddon | null = null
      try {
        candidate = new WebglAddon()
        addon = candidate
        contextLossDisposable = candidate.onContextLoss(() => {
          if (!addon) return
          console.warn(terminalLogMessage(loggerName, 'WebGL renderer context lost; falling back to the default renderer.'))
          disposeRenderer()
          unavailable = true
          onFailure({ renderer: 'webgl', reason: 'context-lost' })
          refreshAfterFallback()
        })
        terminal.loadAddon(candidate)
      } catch (error) {
        if (addon) {
          disposeRenderer()
        } else {
          try {
            candidate?.dispose()
          } catch (disposeError) {
            console.warn(terminalLogMessage(loggerName, 'Failed to dispose unavailable WebGL renderer addon:'), disposeError)
          }
        }
        unavailable = true
        console.warn(terminalLogMessage(loggerName, 'WebGL renderer unavailable; falling back to the default renderer:'), error)
        onFailure({ renderer: 'webgl', reason: 'unavailable', error })
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeRenderer()
    },
  }
}
