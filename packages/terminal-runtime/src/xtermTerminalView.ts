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
  TerminalViewPresentationEvidence,
  TerminalViewPresentationLine,
  TerminalViewPresentationSnapshot,
  TerminalViewRendererFailure,
} from './terminalView'

export interface XtermTerminalViewOptions extends TerminalViewFactoryOptions {}

interface PendingPresentationDrain {
  targetWriteGeneration: number
  minimumRenderFrame: number
  resolve(evidence: TerminalViewPresentationEvidence): void
  reject(error: Error): void
}


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
  let writeGeneration = 0
  let parsedGeneration = 0
  let renderFrame = 0
  let renderedRows = { start: 0, end: 0 }
  const pendingPresentationDrains: PendingPresentationDrain[] = []
  let presentationRefreshRequested = false
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

  function currentRendererName(): string {
    return webglAddon ? 'xterm-webgl' : 'xterm-default'
  }

  function createPresentationEvidence(): TerminalViewPresentationEvidence {
    return {
      writeGeneration,
      parsedGeneration,
      renderFrame,
      renderedRows,
      renderer: currentRendererName(),
      presentedAt: typeof performance === 'undefined' ? Date.now() : performance.now(),
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      geometry: { cols: terminal.cols, rows: terminal.rows },
    }
  }

  function resolvePresentationDrains(): void {
    for (let index = pendingPresentationDrains.length - 1; index >= 0; index -= 1) {
      const pending = pendingPresentationDrains[index]
      if (!pending
        || parsedGeneration < pending.targetWriteGeneration
        || renderFrame < pending.minimumRenderFrame) continue
      pendingPresentationDrains.splice(index, 1)
      pending.resolve(createPresentationEvidence())
    }
  }

  function rejectPresentationDrains(error: Error): void {
    presentationRefreshRequested = false
    for (const pending of pendingPresentationDrains.splice(0)) pending.reject(error)
  }

  function requestPresentationRefresh(): void {
    if (presentationRefreshRequested
      || pendingPresentationDrains.length === 0
      || !opened
      || !hostDiv.parentNode
      || pendingPresentationDrains.every(pending => parsedGeneration < pending.targetWriteGeneration)) return
    presentationRefreshRequested = true
    refresh()
  }

  const writeParsedDisposable = terminal.onWriteParsed(() => {
    parsedGeneration = writeGeneration
    requestPresentationRefresh()
  })
  const renderDisposable = terminal.onRender(range => {
    renderFrame += 1
    renderedRows = range
    presentationRefreshRequested = false
    resolvePresentationDrains()
    requestPresentationRefresh()
  })

  function fitAndRefresh(): void {
    fit()
    refresh()
  }

  function capturePresentation(): TerminalViewPresentationSnapshot {
    const buffer = terminal.buffer.active
    const lines: TerminalViewPresentationLine[] = []
    for (let row = 0; row < terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row)
      if (!line) continue
      const cells: TerminalViewPresentationLine['cells'] = []
      for (let column = 0; column < terminal.cols; column += 1) {
        const cell = line.getCell(column)
        if (!cell || cell.getChars() === '') continue
        cells.push({
          column,
          text: cell.getChars(),
          width: cell.getWidth(),
          foreground: { mode: cell.getFgColorMode(), value: cell.getFgColor() },
          background: { mode: cell.getBgColorMode(), value: cell.getBgColor() },
          bold: Boolean(cell.isBold()),
          italic: Boolean(cell.isItalic()),
          underline: Boolean(cell.isUnderline()),
          dim: Boolean(cell.isDim()),
          inverse: Boolean(cell.isInverse()),
          invisible: Boolean(cell.isInvisible()),
          strikethrough: Boolean(cell.isStrikethrough()),
          overline: Boolean(cell.isOverline()),
        })
      }
      const text = line.translateToString(true)
      if (text === '' && cells.length === 0) continue
      lines.push({ row, text, wrapped: line.isWrapped, cells })
    }
    return {
      geometry: { cols: terminal.cols, rows: terminal.rows },
      activeBuffer: buffer.type,
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
      selectionText: terminal.getSelection(),
      lines,
    }
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
      rejectPresentationDrains(new Error('TerminalView detached before presentation drained'))
      hostDiv.parentNode?.removeChild(hostDiv)
    },
    isMountedIn(container) {
      return hostDiv.parentNode === container
    },
    bootstrap(data) {
      writeGeneration += 1
      terminal.write(data)
    },
    writeLive(output) {
      writeGeneration += 1
      terminal.write(output.data)
    },
    drainPresentation() {
      if (disposed) return Promise.reject(new Error('Cannot drain a disposed TerminalView'))
      if (!opened || !hostDiv.parentNode) {
        return Promise.reject(new Error('Cannot drain an unmounted TerminalView'))
      }
      return new Promise<TerminalViewPresentationEvidence>((resolve, reject) => {
        pendingPresentationDrains.push({
          targetWriteGeneration: writeGeneration,
          minimumRenderFrame: renderFrame + 1,
          resolve,
          reject,
        })
        requestPresentationRefresh()
      })
    },
    capturePresentation,
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
      rejectPresentationDrains(new Error('TerminalView was disposed before presentation drained'))
      writeParsedDisposable.dispose()
      renderDisposable.dispose()
      hostDiv.parentNode?.removeChild(hostDiv)
      rendererFailureListeners.clear()
      disposeWebgl()
      terminal.dispose()
    },
  }
}
