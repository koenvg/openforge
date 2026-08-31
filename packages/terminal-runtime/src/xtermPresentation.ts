import type { Terminal } from '@xterm/xterm'
import type { TerminalPerformanceTrace } from './terminalPerformanceTrace'
import type {
  TerminalViewPresentationEvidence,
  TerminalViewPresentationLine,
  TerminalViewPresentationSnapshot,
} from './terminalView'

interface PendingPresentationDrain {
  targetWriteGeneration: number
  minimumRenderFrame: number
  resolve(evidence: TerminalViewPresentationEvidence): void
  reject(error: Error): void
}

export interface XtermPresentationOptions {
  terminal: Terminal
  terminalKey?: string
  performanceTrace?: TerminalPerformanceTrace
  rendererName(): string
  canPresent(): boolean
  refresh(): void
}

export interface XtermPresentationController {
  recordWrite(ptyInstanceId?: number | null): number
  drain(): Promise<TerminalViewPresentationEvidence>
  detach(): void
  capture(): TerminalViewPresentationSnapshot
  dispose(): void
}

export function createXtermPresentationController(
  { terminal, terminalKey, performanceTrace, rendererName, canPresent, refresh }: XtermPresentationOptions,
): XtermPresentationController {
  let writeGeneration = 0
  let parsedGeneration = 0
  let renderFrame = 0
  let renderedRows = { start: 0, end: 0 }
  let refreshRequested = false
  let frameScheduled = false
  let disposed = false
  const pendingDrains: PendingPresentationDrain[] = []

  function createEvidence(): TerminalViewPresentationEvidence {
    return {
      writeGeneration,
      parsedGeneration,
      renderFrame,
      renderedRows,
      renderer: rendererName(),
      presentedAt: typeof performance === 'undefined' ? Date.now() : performance.now(),
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      geometry: { cols: terminal.cols, rows: terminal.rows },
    }
  }

  function resolveDrains(): void {
    for (let index = pendingDrains.length - 1; index >= 0; index -= 1) {
      const pending = pendingDrains[index]
      if (!pending
        || parsedGeneration < pending.targetWriteGeneration
        || renderFrame < pending.minimumRenderFrame) continue
      pendingDrains.splice(index, 1)
      if (terminalKey) {
        performanceTrace?.mark('presentationProof', {
          terminalKey,
          writeGeneration: parsedGeneration,
        })
      }
      pending.resolve(createEvidence())
    }
  }

  function rejectDrains(error: Error): void {
    refreshRequested = false
    for (const pending of pendingDrains.splice(0)) pending.reject(error)
  }

  function requestRefresh(): void {
    if (refreshRequested
      || pendingDrains.length === 0
      || !canPresent()
      || pendingDrains.every(pending => parsedGeneration < pending.targetWriteGeneration)) return
    refreshRequested = true
    refresh()
  }

  function scheduleFrame(): void {
    if (frameScheduled) return
    frameScheduled = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        frameScheduled = false
        resolveDrains()
        requestRefresh()
      })
    })
  }

  const writeParsedDisposable = terminal.onWriteParsed(() => {
    parsedGeneration = writeGeneration
    if (terminalKey) {
      performanceTrace?.mark('xtermParse', { terminalKey, writeGeneration: parsedGeneration })
    }
    requestRefresh()
  })
  const renderDisposable = terminal.onRender(range => {
    renderFrame += 1
    if (terminalKey) {
      performanceTrace?.mark('renderCallback', { terminalKey, writeGeneration: parsedGeneration })
    }
    renderedRows = range
    refreshRequested = false
    scheduleFrame()
  })

  return {
    recordWrite(ptyInstanceId) {
      writeGeneration += 1
      if (terminalKey && ptyInstanceId !== undefined) {
        performanceTrace?.recordWrite({ terminalKey, ptyInstanceId, writeGeneration })
      }
      return writeGeneration
    },
    drain() {
      if (disposed) return Promise.reject(new Error('Cannot drain a disposed TerminalView'))
      if (!canPresent()) return Promise.reject(new Error('Cannot drain an unmounted TerminalView'))
      return new Promise<TerminalViewPresentationEvidence>((resolve, reject) => {
        pendingDrains.push({
          targetWriteGeneration: writeGeneration,
          minimumRenderFrame: renderFrame + 1,
          resolve,
          reject,
        })
        requestRefresh()
      })
    },
    detach() {
      rejectDrains(new Error('TerminalView detached before presentation drained'))
    },
    capture() {
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
    },
    dispose() {
      if (disposed) return
      disposed = true
      rejectDrains(new Error('TerminalView was disposed before presentation drained'))
      writeParsedDisposable.dispose()
      renderDisposable.dispose()
    },
  }
}
