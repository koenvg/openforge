import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { isTerminalQueryResponse } from './terminalAuthority'
import { loadXtermImageSupport } from './xtermImageSupport'
import { createTerminalLinkHandler, loadTerminalWebLinksAddon } from './terminalLinks'
import { getTerminalOptions } from './terminalOptions'
import { createXtermPresentationController } from './xtermPresentation'
import type {
  TerminalView,
  TerminalViewFactoryOptions,
  TerminalViewGeometry,
  TerminalViewQueryResponse,
  TerminalViewRendererFailure,
} from './terminalView'
import { createXtermWebglRendererLifecycle } from './xtermWebglRenderer'

export interface XtermTerminalViewOptions extends TerminalViewFactoryOptions {}

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
  const imageSupport = loadXtermImageSupport({
    terminal,
    enableImages: options.enableImages,
    loggerName: options.loggerName,
  })
  const hostDiv = createHostDiv()
  const rendererFailureListeners = new Set<(failure: TerminalViewRendererFailure) => void>()
  const userInputListeners = new Set<(data: string) => void>()
  const queryResponseListeners = new Set<(response: TerminalViewQueryResponse) => void>()
  const pendingWrites: Array<{ ptyInstanceId: number | null }> = []
  const xtermDataSubscription = terminal.onData((data) => {
    if (isTerminalQueryResponse(data)) {
      const response = { data, ptyInstanceId: pendingWrites[0]?.ptyInstanceId ?? null }
      for (const listener of queryResponseListeners) listener(response)
      return
    }
    for (const listener of userInputListeners) listener(data)
  })
  let opened = false
  let disposed = false

  function notifyRendererFailure(failure: TerminalViewRendererFailure): void {
    for (const listener of rendererFailureListeners) listener(failure)
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

  const webglRenderer = createXtermWebglRendererLifecycle({
    terminal,
    loggerName: options.loggerName,
    onFailure: notifyRendererFailure,
    refreshAfterFallback: () => {
      if (hostDiv.parentNode) fitAndRefresh()
    },
  })
  const presentation = createXtermPresentationController({
    terminal,
    rendererName: () => webglRenderer.rendererName,
    canPresent: () => opened && Boolean(hostDiv.parentNode),
    refresh,
  })

  function writeScoped(data: string | Uint8Array, ptyInstanceId: number | null): void {
    presentation.recordWrite()
    const pendingWrite = { ptyInstanceId }
    pendingWrites.push(pendingWrite)
    terminal.write(data, () => {
      const index = pendingWrites.indexOf(pendingWrite)
      if (index >= 0) pendingWrites.splice(index, 1)
    })
  }

  return {
    get geometry() {
      return { cols: terminal.cols, rows: terminal.rows }
    },
    get imageProtocol() {
      return imageSupport.protocol
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
      webglRenderer.load()
    },
    unmount() {
      presentation.detach()
      hostDiv.parentNode?.removeChild(hostDiv)
    },
    isMountedIn(container) {
      return hostDiv.parentNode === container
    },
    bootstrap(data, ptyInstanceId) {
      writeScoped(data, ptyInstanceId)
    },
    writeLive(output) {
      writeScoped(output.data, output.ptyInstanceId)
    },
    drainPresentation() {
      return presentation.drain()
    },
    capturePresentation() {
      return presentation.capture()
    },
    focus() {
      terminal.focus()
    },
    reset() {
      imageSupport.reset()
      terminal.reset()
    },
    refresh,
    fit,
    onUserInput(listener) {
      userInputListeners.add(listener)
      return { dispose: () => userInputListeners.delete(listener) }
    },
    onQueryResponse(listener) {
      queryResponseListeners.add(listener)
      return { dispose: () => queryResponseListeners.delete(listener) }
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
      presentation.dispose()
      hostDiv.parentNode?.removeChild(hostDiv)
      rendererFailureListeners.clear()
      userInputListeners.clear()
      queryResponseListeners.clear()
      pendingWrites.length = 0
      xtermDataSubscription.dispose()
      webglRenderer.dispose()
      terminal.dispose()
    },
  }
}
