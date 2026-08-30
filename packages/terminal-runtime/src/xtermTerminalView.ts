import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { isValidTerminalDimensions } from './terminalAttachment'
import { loadXtermImageSupport } from './xtermImageSupport'
import { terminalLogMessage } from './terminalLogging'
import { createTerminalLinkHandler, loadTerminalWebLinksAddon } from './terminalLinks'
import { getTerminalOptions, type TerminalFontLoadOutcome } from './terminalOptions'
import { createXtermPresentationController } from './xtermPresentation'
import type {
  TerminalView,
  TerminalViewFactoryOptions,
  TerminalViewGeometry,
  TerminalViewRendererFailure,
  TerminalViewSnapshot,
} from './terminalView'
import { createXtermWebglRendererLifecycle } from './xtermWebglRenderer'

export interface XtermTerminalViewOptions extends TerminalViewFactoryOptions {}

function isTerminalQueryResponse(data: string): boolean {
  return /^\u001b\[(?:[?>]?[\d;]*c|\??\d+(?:;\d+)?[nR]|\??\d+;\d+\$y|[468];\d+;\d+t)$/.test(data)
    || /^\u001bP[01]\$r[\s\S]*\u001b\\$/.test(data)
    || /^\u001b\](?:4;\d+|1[012]);rgb:[^\u001b]*(?:\u0007|\u001b\\)$/.test(data)
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
  const imageSupport = loadXtermImageSupport({
    terminal,
    enableImages: options.enableImages,
    loggerName: options.loggerName,
  })
  const hostDiv = createHostDiv()
  const rendererFailureListeners = new Set<(failure: TerminalViewRendererFailure) => void>()
  const userInputListeners = new Set<(data: string) => void>()
  const xtermDataSubscription = terminal.onData((data) => {
    if (isTerminalQueryResponse(data)) return
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
    if (!isValidTerminalDimensions(dimensions)) return null
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
  let completedFontLoad: TerminalFontLoadOutcome | null = null
  function handleFontLoadCompletion(outcome: TerminalFontLoadOutcome): void {
    completedFontLoad = outcome
    if (outcome.status === 'failed') {
      if (opened && !disposed) {
        console.warn(
          terminalLogMessage(
            options.loggerName,
            'Bundled terminal fonts failed to load after xterm opened; continuing with fallback fonts:',
          ),
          outcome.error,
        )
      }
      return
    }
    if (!opened || disposed) return
    webglRenderer.clearTextureAtlas()
    if (hostDiv.parentNode) fitAndRefresh()
  }
  if (options.fontReadiness.status === 'timed-out') {
    void options.fontReadiness.completion.then(handleFontLoadCompletion)
  }

  function reportFontReadinessBeforeOpen(): void {
    const readiness = completedFontLoad ?? options.fontReadiness
    if (readiness.status === 'failed') {
      console.warn(
        terminalLogMessage(options.loggerName, 'Bundled terminal fonts failed to load; opening xterm with fallback fonts:'),
        readiness.error,
      )
    } else if (readiness.status === 'timed-out') {
      console.warn(terminalLogMessage(
        options.loggerName,
        'Bundled terminal fonts are still loading; opening xterm with fallback fonts until they become ready.',
      ))
    }
  }

  const presentation = createXtermPresentationController({
    terminal,
    rendererName: () => webglRenderer.rendererName,
    canPresent: () => opened && Boolean(hostDiv.parentNode),
    refresh,
  })

  function write(data: string | Uint8Array): void {
    presentation.recordWrite()
    terminal.write(data)
  }


  function writeAndWait(data: string | Uint8Array): Promise<void> {
    presentation.recordWrite()
    return new Promise(resolve => terminal.write(data, resolve))
  }

  function hasData(data: string | Uint8Array | undefined): data is string | Uint8Array {
    return typeof data === 'string' ? data.length > 0 : Boolean(data?.byteLength)
  }

  async function replaceSnapshot(snapshot: TerminalViewSnapshot): Promise<void> {
    await new Promise<void>(resolve => terminal.write('', resolve))
    if (disposed) return
    imageSupport.reset()
    terminal.reset()
    if (hasData(snapshot.compatibilityData)) await writeAndWait(snapshot.compatibilityData)
    if (hasData(snapshot.data)) await writeAndWait(snapshot.data)
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
      reportFontReadinessBeforeOpen()
      terminal.open(hostDiv)
      opened = true
      webglRenderer.load()
    },
    unmount() {
      terminal.blur()
      presentation.detach()
      hostDiv.parentNode?.removeChild(hostDiv)
    },
    isMountedIn(container) {
      return hostDiv.parentNode === container
    },
    bootstrap(data) {
      write(data)
    },
    replaceSnapshot,
    writeLive(output) {
      write(output.data)
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
      xtermDataSubscription.dispose()
      webglRenderer.dispose()
      terminal.dispose()
    },
  }
}
