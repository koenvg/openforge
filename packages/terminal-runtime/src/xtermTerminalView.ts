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
    ...getTerminalOptions(
      options.theme ?? options.appearance ?? options.themeMode ?? 'light',
      options.fontFamily,
      options.fontSize,
    ),
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
  let visible = false
  let visibilityManaged = false
  let refreshPending = false
  let disposed = false
  let snapshotGeneration = 0
  let snapshotReady = true
  let revealGeneration: number | null = null
  let revealPending: Promise<void> | null = null
  let hasOutput = false
  let snapshotPaintPending = false
  let focusPending = false

  function setConcealed(concealed: boolean): void {
    // Opacity preserves dimensions and keeps xterm's renderer active. Neither
    // display:none nor visibility:hidden can provide that rendering guarantee.
    if (concealed) {
      focusPending ||= hostDiv.contains(document.activeElement)
      hostDiv.style.opacity = '0'
    } else {
      hostDiv.style.removeProperty('opacity')
    }
    hostDiv.inert = concealed
    if (!concealed && focusPending && visible && hostDiv.parentNode) {
      focusPending = false
      if (document.activeElement === document.body) terminal.focus()
    }
  }

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

  function fitAndRefreshWhenVisible(): void {
    if (!visible || !hostDiv.parentNode) {
      refreshPending = true
      return
    }
    refreshPending = false
    fitAndRefresh()
  }

  const webglRenderer = createXtermWebglRendererLifecycle({
    terminal,
    loggerName: options.loggerName,
    onFailure: notifyRendererFailure,
    refreshAfterFallback: fitAndRefreshWhenVisible,
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
    fitAndRefreshWhenVisible()
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
    terminalKey: options.terminalKey,
    performanceTrace: options.performanceTrace,
    rendererName: () => webglRenderer.rendererName,
    canPresent: () => opened && visible && Boolean(hostDiv.parentNode),
    refresh,
  })

  function revealWhenReady(): void {
    if (!snapshotReady || hostDiv.style.opacity !== '0'
      || !opened || !visible || !hostDiv.parentNode || disposed
      || revealGeneration === snapshotGeneration) return
    const generation = snapshotGeneration
    revealGeneration = generation
    revealPending = presentation.drain().then(() => {
      if (disposed || generation !== snapshotGeneration || !visible || !hostDiv.parentNode) return
      snapshotPaintPending = false
      setConcealed(false)
      revealGeneration = null
    }, () => {
      if (revealGeneration === generation) revealGeneration = null
    })
  }

  function write(data: string | Uint8Array, ptyInstanceId?: number | null): void {
    hasOutput ||= hasData(data)
    const generation = presentation.recordWrite(ptyInstanceId)
    terminal.write(data, () => presentation.completeWrite(generation))
  }


  function writeAndWait(data: string | Uint8Array): Promise<void> {
    const generation = presentation.recordWrite()
    return new Promise(resolve => terminal.write(data, () => {
      presentation.completeWrite(generation)
      resolve()
    }))
  }

  function hasData(data: string | Uint8Array | undefined): data is string | Uint8Array {
    return typeof data === 'string' ? data.length > 0 : Boolean(data?.byteLength)
  }

  async function replaceSnapshot(snapshot: TerminalViewSnapshot): Promise<void> {
    if (snapshot.ptyInstanceId !== null && snapshot.continuationData === undefined) {
      throw new Error('Live terminal recovery requires explicit parser continuation')
    }
    const generation = ++snapshotGeneration
    snapshotReady = false
    const isCurrent = () => !disposed && snapshotGeneration === generation
    const snapshotHasOutput = hasData(snapshot.data) || hasData(snapshot.compatibilityData) || hasData(snapshot.continuationData)
    const conceal = hasOutput || snapshotHasOutput || snapshotPaintPending
    snapshotPaintPending = conceal
    hasOutput = snapshotHasOutput
    if (conceal) setConcealed(true)
    await new Promise<void>(resolve => terminal.write('', resolve))
    if (!isCurrent()) return
    imageSupport.reset()
    terminal.reset()
    if (hasData(snapshot.compatibilityData)) {
      await writeAndWait(snapshot.compatibilityData)
      if (!isCurrent()) return
      // Cancel the replay's unfinished parser/UTF-8 input before portable VT.
      // Use bytes so xterm's byte decoder also leaves any partial code point.
      await writeAndWait(new Uint8Array([0x18]))
      if (!isCurrent()) return
    }
    if (hasData(snapshot.data)) await writeAndWait(snapshot.data)
    if (!isCurrent()) return
    if (hasData(snapshot.continuationData)) await writeAndWait(snapshot.continuationData)
    if (!isCurrent()) return
    snapshotReady = true
    if (!conceal) setConcealed(false)
    else revealWhenReady()
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
      if (!visibilityManaged) visible = true
      container.appendChild(hostDiv)
      if (opened) {
        if (refreshPending) fitAndRefreshWhenVisible()
        revealWhenReady()
        return
      }
      reportFontReadinessBeforeOpen()
      terminal.open(hostDiv)
      opened = true
      options.performanceTrace?.mark('xtermMount', { terminalKey: options.terminalKey })
      webglRenderer.load()
      revealWhenReady()
    },
    setVisible(nextVisible) {
      if (visibilityManaged && visible === nextVisible) return
      visibilityManaged = true
      if (!nextVisible) {
        snapshotGeneration += 1
        // Cancel unfinished writes, but retain completed state for remount.
        // PTY replacement invalidates that state explicitly via invalidateSnapshot().
        setConcealed(true)
      }
      visible = nextVisible
      if (!visible) {
        presentation.detach()
        return
      }
      if (refreshPending) fitAndRefreshWhenVisible()
      revealWhenReady()
    },
    unmount() {
      snapshotGeneration += 1
      setConcealed(true)
      visible = false
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
    invalidateSnapshot() {
      snapshotGeneration += 1
      snapshotReady = false
      setConcealed(true)
      presentation.detach()
    },
    replaceSnapshot,
    writeLive(output) {
      write(output.data, output.ptyInstanceId)
    },
    async drainPresentation() {
      const evidence = await presentation.drain()
      await revealPending
      return evidence
    },
    capturePresentation() {
      return presentation.capture()
    },
    focus() {
      if (hostDiv.inert) focusPending = true
      else terminal.focus()
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
    setFontFamily(fontFamily) {
      terminal.options.fontFamily = fontFamily
      fitAndRefreshWhenVisible()
    },
    setFontSize(fontSize) {
      terminal.options.fontSize = fontSize
      fitAndRefreshWhenVisible()
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
