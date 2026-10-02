import { Terminal as CandidateTerminal } from './dist/candidate.js'
import { Terminal as BaselineTerminal } from './dist/baseline.js'
import type { IParsedHistoryPage, Terminal } from '@xterm/xterm'

export interface Fixture {
  snapshotId: string
  watermark: number
  geometry: { cols: number; rows: number }
  retention: number
  historyRows: number
  screenVt: string
  pages: IParsedHistoryPage[]
  inputVt: string
  liveVt: string
}

export function painted(terminal: Terminal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { listener.dispose(); reject(new Error('xterm did not render in the active Arc tab')) }, 5000)
    const listener = terminal.onRender(() => {
      listener.dispose()
      clearTimeout(timeout)
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    terminal.refresh(0, terminal.rows - 1)
  })
}

// Frozen authority output only. This adapter never connects to a PTY or IPC.
export class FixtureComparison {
  readonly candidate: Terminal
  readonly baseline: Terminal
  readonly ready: Promise<void>
  private pageIndex = 0
  private input = ''
  private pendingLive: string[] = []
  private liveInjected = false
  private typed = false
  private generation = 0
  private historyOperation: Promise<void> = Promise.resolve()
  private baselineConcealed = true
  private baselineMirroring = false
  private historyTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private fixture: Fixture, private candidateHost: HTMLElement, private baselineHost: HTMLElement, private changed: () => void) {
    const options = { ...fixture.geometry, scrollback: fixture.retention, allowProposedApi: true, cursorBlink: false, cursorInactiveStyle: 'none' as const, fontFamily: 'monospace', fontSize: 15, theme: { background: '#101820', foreground: '#edf2f7' } }
    this.candidate = new CandidateTerminal(options)
    this.baseline = new BaselineTerminal(options)
    this.candidate.open(candidateHost)
    this.baseline.open(baselineHost)
    this.candidate.onData(data => { void this.controlledInput(data).catch(error => this.showError(error)) })
    this.baseline.onData(data => { void this.controlledInput(data).catch(error => this.showError(error)) })
    this.ready = this.reset()
  }

  private showError(error: unknown): void {
    document.querySelector('#error')!.textContent = String(error)
  }

  pauseHistory(): void {
    clearTimeout(this.historyTimer)
    this.historyTimer = undefined
    this.changed()
  }

  resumeHistory(): void {
    if (this.historyTimer !== undefined || this.pageIndex >= this.fixture.pages.length) return
    this.historyTimer = setTimeout(() => { void this.releaseOnePage().catch(error => this.showError(error)) }, 1000)
    this.changed()
  }

  reset(): Promise<void> {
    this.pauseHistory()
    const generation = ++this.generation
    this.pageIndex = 0
    this.input = ''
    this.pendingLive = []
    this.liveInjected = false
    this.typed = false
    this.baselineConcealed = true
    this.baselineMirroring = false
    this.baselineHost.style.opacity = '0'
    this.baselineHost.inert = true
    // Cancel any partial escape sequence and reset behind all queued baseline bytes.
    // Supersede the old operation owner; new releases wait for both parser fences.
    const restored = Promise.all([
      new Promise<void>(resolve => this.baseline.write('\x18\x1bc', resolve)),
      this.candidate.restoreScreenFirst({ ...this.fixture.geometry, ...this.fixture }),
    ])
    this.historyOperation = restored.then(async () => {
      if (generation !== this.generation) return
      await painted(this.candidate)
      this.changed()
    })
    return this.historyOperation
  }

  releaseOnePage(): Promise<void> {
    this.pauseHistory()
    const generation = this.generation
    // Timer and click releases share ownership and cannot run ahead of reset.
    this.historyOperation = this.historyOperation.then(async () => {
      if (generation !== this.generation || this.pageIndex >= this.fixture.pages.length) return
      this.candidate.prependHistoryPage(this.fixture.pages[this.pageIndex++])
      if (this.pageIndex === this.fixture.pages.length) {
        await new Promise<void>(resolve => this.baseline.write(this.fixture.inputVt, resolve))
        if (generation !== this.generation) return
        // Queue the complete drain before routing new output directly to baseline.
        // Presentation stays concealed until paint, independently of write ownership.
        const drained = new Promise<void>(resolve => this.baseline.write(this.pendingLive.join(''), resolve))
        this.pendingLive = []
        this.baselineMirroring = true
        await drained
        await painted(this.baseline)
        if (generation !== this.generation) return
        this.baselineConcealed = false
        this.baselineHost.style.opacity = '1'
        this.baselineHost.inert = false
      }
      await painted(this.candidate)
      this.changed()
    })
    return this.historyOperation
  }

  private async output(data: string): Promise<void> {
    const generation = this.generation
    await new Promise<void>(resolve => this.candidate.write(data, resolve))
    if (generation !== this.generation) return
    if (!this.baselineMirroring) this.pendingLive.push(data)
    else await new Promise<void>(resolve => this.baseline.write(data, resolve))
    if (generation !== this.generation) return
    await painted(this.candidate)
    this.changed()
  }

  async injectLiveOutput(): Promise<void> {
    if (this.liveInjected) return
    this.liveInjected = true
    await this.output(this.fixture.liveVt)
  }

  async controlledInput(data: string): Promise<void> {
    this.input += data
    // Only this single glyph is part of the frozen authority fixture.
    if (data === 'k' && !this.typed) { this.typed = true; await this.output('k') }
    this.changed()
  }

  async scrollHistory(): Promise<void> {
    this.candidate.scrollToTop()
    this.baseline.scrollToTop()
    await painted(this.candidate)
    this.changed()
  }

  async liveScreen(): Promise<void> {
    this.candidate.scrollToBottom()
    this.baseline.scrollToBottom()
    await painted(this.candidate)
    this.changed()
  }

  status() {
    const read = (terminal: Terminal) => ({
      cells: Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)!.translateToString(true)),
      cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY],
      history: terminal.buffer.active.baseY,
      viewport: terminal.buffer.active.viewportY,
    })
    return {
      candidate: read(this.candidate), baseline: read(this.baseline),
      historyPaused: this.historyTimer === undefined,
      pendingPages: this.fixture.pages.length - this.pageIndex, input: this.input, baselineConcealed: this.baselineConcealed,
      paintedCandidate: this.candidateHost.querySelector('.xterm-rows')?.textContent ?? '',
    }
  }
}
