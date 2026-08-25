import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import {
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_LIMIT_MB,
  createItermImageCompatibilityAddon,
  type TerminalImageProtocol,
} from './terminalImages'
import { createTerminalLinkHandler, loadTerminalWebLinksAddon } from './terminalLinks'
import { terminalLogMessage } from './terminalLogging'
import { getTerminalOptions } from './terminalOptions'
import type {
  TerminalView,
  TerminalViewFactoryOptions,
  TerminalViewGeometry,
  TerminalViewRendererFailure,
} from './terminalView'

export interface XtermTerminalViewOptions extends TerminalViewFactoryOptions {}


function loadImageSupport(
  options: XtermTerminalViewOptions,
  terminal: Terminal,
): { imageAddon: ImageAddon | null; imageProtocol: TerminalImageProtocol | null } {
  if (options.enableImages === false) return { imageAddon: null, imageProtocol: null }

  const imageAddon = new ImageAddon({
    enableSizeReports: true,
    pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
    storageLimit: TERMINAL_IMAGE_STORAGE_LIMIT_MB,
    showPlaceholder: true,
    sixelSupport: false,
    iipSupport: true,
    iipSizeLimit: TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  })

  try {
    terminal.loadAddon(imageAddon)
  } catch (error) {
    try {
      imageAddon.dispose()
    } catch (disposeError) {
      console.warn(terminalLogMessage(options.loggerName, 'Failed to dispose unavailable image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(options.loggerName, 'Inline images unavailable; keeping text fallbacks:'), error)
    return { imageAddon: null, imageProtocol: null }
  }

  const compatibilityAddon = createItermImageCompatibilityAddon()
  try {
    terminal.loadAddon(compatibilityAddon)
    return { imageAddon, imageProtocol: 'iterm2' }
  } catch (error) {
    compatibilityAddon.dispose()
    try {
      imageAddon.dispose()
    } catch (disposeError) {
      console.warn(terminalLogMessage(options.loggerName, 'Failed to dispose unvalidated image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(options.loggerName, 'Inline image validation unavailable; keeping text fallbacks:'), error)
    return { imageAddon: null, imageProtocol: null }
  }
}

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.width = '100%'
  div.style.height = '100%'
  return div
}

export function createXtermTerminalView(options: XtermTerminalViewOptions): TerminalView {
  const linkOptions = { openLink: options.openLink, loggerName: options.loggerName }
  const terminal = new Terminal({
    ...getTerminalOptions(options.themeMode),
    linkHandler: createTerminalLinkHandler(linkOptions),
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  loadTerminalWebLinksAddon(linkOptions, terminal)
  const imageSupport = loadImageSupport(options, terminal)
  const hostDiv = createHostDiv()
  const rendererFailureListeners = new Set<(failure: TerminalViewRendererFailure) => void>()
  let webglAddon: WebglAddon | null = null
  let webglContextLossDisposable: { dispose(): void } | null = null
  let webglUnavailable = false
  let opened = false
  let disposed = false

  function notifyRendererFailure(failure: TerminalViewRendererFailure): void {
    for (const listener of rendererFailureListeners) listener(failure)
  }

  function disposeWebgl(): void {
    const addon = webglAddon
    webglAddon = null
    try {
      webglContextLossDisposable?.dispose()
    } catch (error) {
      console.warn(terminalLogMessage(options.loggerName, 'Failed to dispose WebGL context loss listener:'), error)
    } finally {
      webglContextLossDisposable = null
    }
    try {
      addon?.dispose()
    } catch (error) {
      console.warn(terminalLogMessage(options.loggerName, 'Failed to dispose WebGL renderer addon:'), error)
    }
  }

  function loadWebgl(): void {
    if (webglAddon || webglUnavailable || disposed) return

    let candidate: WebglAddon | null = null
    try {
      candidate = new WebglAddon()
      webglAddon = candidate
      webglContextLossDisposable = candidate.onContextLoss(() => {
        if (!webglAddon) return
        console.warn(terminalLogMessage(options.loggerName, 'WebGL renderer context lost; falling back to the default renderer.'))
        disposeWebgl()
        webglUnavailable = true
        notifyRendererFailure({ renderer: 'webgl', reason: 'context-lost' })
        if (hostDiv.parentNode) fitAndRefresh()
      })
      terminal.loadAddon(candidate)
    } catch (error) {
      if (webglAddon) {
        disposeWebgl()
      } else {
        try {
          candidate?.dispose()
        } catch (disposeError) {
          console.warn(terminalLogMessage(options.loggerName, 'Failed to dispose unavailable WebGL renderer addon:'), disposeError)
        }
      }
      webglUnavailable = true
      console.warn(terminalLogMessage(options.loggerName, 'WebGL renderer unavailable; falling back to the default renderer:'), error)
      notifyRendererFailure({ renderer: 'webgl', reason: 'unavailable', error })
    }
  }

  function fit(): TerminalViewGeometry | null {
    if (hostDiv.clientWidth === 0 || hostDiv.clientHeight === 0) return null
    const dimensions = fitAddon.proposeDimensions()
    if (!dimensions
      || typeof dimensions.cols !== 'number'
      || typeof dimensions.rows !== 'number'
      || Number.isNaN(dimensions.cols)
      || Number.isNaN(dimensions.rows)) return null
    fitAddon.fit()
    return dimensions
  }

  function refresh(): void {
    terminal.refresh(0, (terminal.rows ?? 1) - 1)
  }

  function fitAndRefresh(): void {
    fit()
    refresh()
  }

  return {
    get geometry() {
      return { cols: terminal.cols, rows: terminal.rows }
    },
    get imageProtocol() {
      return imageSupport.imageProtocol
    },
    get resizeTarget() {
      return hostDiv
    },
    mount(container) {
      if (disposed) return
      container.appendChild(hostDiv)
      if (opened) return
      terminal.open(hostDiv)
      opened = true
      loadWebgl()
    },
    unmount() {
      hostDiv.parentNode?.removeChild(hostDiv)
    },
    isMountedIn(container) {
      return hostDiv.parentNode === container
    },
    bootstrap(data) {
      terminal.write(data)
    },
    writeLive(output) {
      terminal.write(output.data)
    },
    focus() {
      terminal.focus()
    },
    reset() {
      imageSupport.imageAddon?.reset()
      terminal.reset()
    },
    refresh,
    fit,
    onUserInput(listener) {
      return terminal.onData(listener)
    },
    setKeyEventHandler(handler) {
      terminal.attachCustomKeyEventHandler(handler)
    },
    getSelectionText() {
      return terminal.getSelection()
    },
    setTheme(theme) {
      terminal.options.theme = theme
    },
    onRendererFailure(listener) {
      rendererFailureListeners.add(listener)
      return { dispose: () => rendererFailureListeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      hostDiv.parentNode?.removeChild(hostDiv)
      rendererFailureListeners.clear()
      disposeWebgl()
      terminal.dispose()
    },
  }
}
