import type { TerminalView, TerminalViewData, TerminalViewFactory, TerminalViewFactoryOptions, TerminalViewGeometry, TerminalViewLiveOutput, TerminalViewRendererFailure, TerminalViewTheme } from '@openforge-app/terminal-runtime'
import type { NativeTerminalIdentity, NativeTerminalInput, NativeTerminalRequest, NativeTerminalState } from '../electron/nativeTerminalProtocol'
import { NativeTerminalPlacement } from './nativeTerminalPlacement'

type Request<T extends NativeTerminalRequest['operation']> = Extract<NativeTerminalRequest, { operation: T }>
type Snapshot = Parameters<TerminalView['replaceSnapshot']>[0]
export interface NativeTerminalPort {
  create(request: Request<'create'>): Promise<NativeTerminalState>
  write(request: Request<'write'>): Promise<void>
  bounds(request: Request<'bounds'>): Promise<NativeTerminalState>
  focus(request: NativeTerminalIdentity & { operation: 'focus'; id: number }): Promise<void>
  hide(request: NativeTerminalIdentity & { operation: 'hide'; id: number }): Promise<void>
  destroy(request: NativeTerminalIdentity & { operation: 'destroy'; id: number }): Promise<void>
  onInput(listener: (event: NativeTerminalInput) => void): Promise<() => void>
}
interface Owner extends NativeTerminalIdentity { id: number; offset: number }
const bytes = (data: TerminalViewData = '') => typeof data === 'string' ? new TextEncoder().encode(data) : data.slice()

/** Adapts portable VT recovery only. It does not claim binary READY or presented frames. */
class NativeTerminalView implements TerminalView {
  readonly imageProtocol = null
  readonly resizeTarget = document.createElement('div')
  private readonly viewId = crypto.randomUUID()
  private readonly placement = new NativeTerminalPlacement(this.resizeTarget, () => { void this.prepare() })
  private readonly owners = new Set<Owner>()
  private readonly inputs = new Set<(data: TerminalViewData) => void>()
  private readonly failures = new Set<(failure: TerminalViewRendererFailure) => void>()
  private readonly subscription: Promise<void>
  private unlisten: (() => void) | null = null
  private queue: Promise<void> = Promise.resolve()
  private owner: Owner | null = null
  private fallback: TerminalView | null = null
  private host: HTMLElement | null = null
  private grid: TerminalViewGeometry = { cols: 80, rows: 24 }
  private generation = 0
  private revision = 0
  private visible = false
  private committed = false
  private disposed = false
  private ptyInstanceId: number | null = null
  private sequence = 0
  private queuedBytes = 0
  private lastBounds = ''
  private keyHandler: (event: KeyboardEvent) => boolean = () => true

  constructor(private readonly options: TerminalViewFactoryOptions, private readonly port: NativeTerminalPort, private readonly createFallback: TerminalViewFactory) {
    this.resizeTarget.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden'
    this.resizeTarget.tabIndex = 0
    this.resizeTarget.setAttribute('aria-label', 'Experimental native terminal')
    this.resizeTarget.dataset.nativeTerminalState = 'initializing'
    this.subscription = port.onInput(event => {
      if (event.id !== this.owner?.id || event.viewId !== this.viewId || event.generation !== this.owner.generation) return
      if (event.kind === 'error') { this.fail(new Error('Native input queue failed')); return }
      if (this.visible && this.committed && this.host && !this.disposed && this.placement.read(true).visible) {
        for (const listener of this.inputs) listener(event.data.slice())
      }
    }).then(unlisten => { if (this.disposed) unlisten(); else this.unlisten = unlisten })
    // Observe subscription failures immediately, including disposal before preparation.
    void this.subscription.catch(error => this.fail(error))
  }

  get geometry(): TerminalViewGeometry { return this.fallback?.geometry ?? this.grid }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => {})
    return result
  }

  private async release(owner: Owner): Promise<void> {
    this.owners.delete(owner)
    await this.port.destroy({ ...owner, operation: 'destroy' })
  }

  private releaseAll(): void {
    this.owner = null
    delete this.resizeTarget.dataset.nativeAttachment
    for (const owner of this.owners) void this.release(owner).catch(error => console.warn('Native terminal teardown failed', error))
  }

  private fail(error: unknown): void {
    if (this.disposed || this.fallback) return
    console.warn('Experimental native terminal fell back to xterm', error)
    this.revision++
    this.committed = false
    this.placement.disconnect()
    this.releaseAll()
    this.resizeTarget.dataset.nativeTerminalState = 'fallback'
    this.fallback = this.createFallback(this.options)
    this.fallback.onUserInput(data => { for (const listener of this.inputs) listener(data) })
    this.fallback.setKeyEventHandler(this.keyHandler)
    if (this.host) this.fallback.mount(this.resizeTarget)
    this.fallback.setVisible(this.visible)
    for (const listener of this.failures) listener({ renderer: 'ghostty-native', reason: 'context-lost', requiresRecovery: true, error })
  }

  private async createOwner(revision: number): Promise<Owner | null> {
    await this.subscription
    if (this.disposed || !this.host || this.revision !== revision || this.fallback) return null
    const bounds = this.placement.read(false)
    if (bounds.width < 1 || bounds.height < 1) throw new Error('Native terminal has no layout')
    const generation = ++this.generation
    const state = await this.port.create({ operation: 'create', viewId: this.viewId, generation, terminalKey: this.options.terminalKey, bounds, fontSize: this.options.fontSize ?? 13 })
    const owner = { viewId: this.viewId, generation, id: state.id, offset: 0 }
    this.owners.add(owner)
    if (this.disposed || !this.host || this.revision !== revision || this.fallback) { await this.release(owner); return null }
    this.grid = { cols: state.cols, rows: state.rows }
    this.lastBounds = ''
    return owner
  }

  private hide(): void {
    const owner = this.owner
    this.lastBounds = ''
    if (owner) void this.port.hide({ ...owner, operation: 'hide' }).catch(error => { if (owner === this.owner) this.fail(error) })
  }

  private async place(owner: Owner): Promise<void> {
    if (owner !== this.owner || !this.host) return
    const bounds = this.placement.read(this.visible && this.committed)
    if (bounds.width < 1 || bounds.height < 1) {
      this.hide()
      return
    }
    const key = JSON.stringify(bounds) + window.devicePixelRatio
    if (key === this.lastBounds) return
    const state = await this.port.bounds({ ...owner, operation: 'bounds', bounds })
    if (owner !== this.owner) return
    this.grid = { cols: state.cols, rows: state.rows }
    this.lastBounds = JSON.stringify(this.placement.read(this.visible && this.committed)) + window.devicePixelRatio === key ? key : ''
  }

  async prepare(): Promise<void> {
    if (this.fallback) { await this.fallback.prepare?.(); return }
    if (!this.host || this.disposed) return
    if (!this.placement.read(this.visible && this.committed).visible) this.hide()
    const layout = this.placement.read(false)
    if (layout.width < 1 || layout.height < 1) return
    const revision = this.revision
    try {
      await this.enqueue(async () => {
        if (this.revision !== revision || this.fallback) return
        this.owner ??= await this.createOwner(revision)
        if (this.owner) await this.place(this.owner)
      })
    } catch (error) { if (this.revision === revision) this.fail(error) }
  }

  mount(container: HTMLElement): void {
    if (this.disposed) throw new Error('Native terminal view is disposed')
    this.host = container
    container.append(this.resizeTarget)
    if (this.fallback) this.fallback.mount(this.resizeTarget)
    else this.placement.observe()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.fallback?.setVisible(visible)
    if (!visible) this.invalidateSnapshot()
    if (this.owner) void this.prepare()
  }

  unmount(): void {
    this.invalidateSnapshot()
    this.host = null
    this.placement.disconnect()
    this.releaseAll()
    this.fallback?.unmount()
    this.resizeTarget.remove()
  }
  isMountedIn(container: HTMLElement): boolean { return this.host === container }

  bootstrap(data: TerminalViewData, ptyInstanceId: number | null, sequence: number): void {
    void this.replaceSnapshot({ data, ptyInstanceId, sequence }).catch(error => this.fail(error))
  }

  invalidateSnapshot(): void {
    this.revision++
    this.resizeTarget.dataset.nativeTerminalState = this.fallback ? 'fallback' : 'restoring'
    this.committed = false
    this.ptyInstanceId = null
    this.fallback?.invalidateSnapshot()
    this.hide()
  }

  async replaceSnapshot(snapshot: Snapshot): Promise<void> {
    if (this.fallback) return this.fallback.replaceSnapshot(snapshot)
    const revision = ++this.revision
    this.committed = false
    this.resizeTarget.dataset.nativeTerminalState = 'restoring'
    this.hide()
    const parts = [bytes(snapshot.data), bytes(snapshot.compatibilityData), bytes(snapshot.continuationData)]
    try {
      await this.enqueue(async () => {
        if (revision !== this.revision || this.disposed || !this.host) return
        if (this.owner) await this.place(this.owner)
        const previous = this.owner
        const owner = await this.createOwner(revision)
        if (!owner) return
        this.owner = owner
        if (previous) await this.release(previous)
        for (const part of parts) await this.append(owner, part, revision)
        if (revision !== this.revision || owner !== this.owner) return
        this.ptyInstanceId = snapshot.ptyInstanceId
        this.sequence = snapshot.sequence
        this.committed = true
        this.resizeTarget.dataset.nativeAttachment = JSON.stringify({ id: owner.id, viewId: owner.viewId, generation: owner.generation })
        this.resizeTarget.dataset.nativeTerminalState = 'live'
        await this.place(owner)
      })
    } catch (error) {
      if (revision !== this.revision || this.disposed) return
      this.fail(error)
      await this.fallback!.replaceSnapshot(snapshot)
    }
  }

  private async append(owner: Owner, data: Uint8Array, revision: number): Promise<void> {
    for (let start = 0; start < data.length; start += 65536) {
      if (revision !== this.revision || owner !== this.owner || this.disposed) return
      const chunk = data.slice(start, start + 65536)
      await this.port.write({ ...owner, operation: 'write', offset: owner.offset, data: chunk })
      owner.offset += chunk.length
    }
  }

  writeLive(output: TerminalViewLiveOutput): void {
    if (this.fallback) { this.fallback.writeLive(output); return }
    if (!this.committed || output.ptyInstanceId !== this.ptyInstanceId || output.sequence <= this.sequence) return
    const owner = this.owner, revision = this.revision, data = bytes(output.data)
    if (!owner) return
    if (this.queuedBytes + data.length > 4 * 1024 * 1024) { this.fail(new Error('Native output queue exceeded 4 MiB')); return }
    this.queuedBytes += data.length
    this.sequence = output.sequence
    void this.enqueue(() => this.append(owner, data, revision))
      .catch(error => { if (revision === this.revision) this.fail(error) })
      .finally(() => { this.queuedBytes -= data.length })
  }

  async drainPresentation(): ReturnType<TerminalView['drainPresentation']> {
    if (this.fallback) return this.fallback.drainPresentation()
    throw new Error('Native presentation acknowledgements are not implemented')
  }
  capturePresentation(): ReturnType<TerminalView['capturePresentation']> {
    if (this.fallback) return this.fallback.capturePresentation()
    throw new Error('Native pixels are not available through the state bridge')
  }
  focus(): void {
    if (this.fallback) { this.fallback.focus(); return }
    this.resizeTarget.focus()
    const owner = this.owner
    if (owner && this.visible && this.committed) void this.enqueue(async () => {
      if (owner === this.owner) await this.port.focus({ ...owner, operation: 'focus' })
    }).catch(error => this.fail(error))
  }
  reset(): void { this.invalidateSnapshot(); this.releaseAll(); this.fallback?.reset() }
  refresh(): void { this.fallback?.refresh(); if (!this.fallback) void this.prepare() }
  fit(): TerminalViewGeometry | null {
    if (this.fallback) return this.fallback.fit()
    const bounds = this.placement.read(false)
    return this.host && this.owner && bounds.width >= 1 && bounds.height >= 1 ? this.grid : null
  }
  onUserInput(listener: (data: TerminalViewData) => void) { this.inputs.add(listener); return { dispose: () => { this.inputs.delete(listener) } } }
  onRendererFailure(listener: (failure: TerminalViewRendererFailure) => void) { this.failures.add(listener); return { dispose: () => { this.failures.delete(listener) } } }
  setKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void { this.keyHandler = handler; this.fallback?.setKeyEventHandler(handler) }
  getSelectionText(): string { return this.fallback?.getSelectionText() ?? '' }
  setTheme(theme: TerminalViewTheme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.options.theme)) return
    this.options.theme = theme
    this.fail(new Error('Native theme updates require xterm fallback'))
    this.fallback?.setTheme(theme)
  }
  setFontFamily(fontFamily: string): void {
    if (fontFamily === this.options.fontFamily) return
    this.options.fontFamily = fontFamily
    this.fail(new Error('Native font changes require xterm fallback'))
    this.fallback?.setFontFamily(fontFamily)
  }
  setFontSize(fontSize: number): void {
    if (fontSize === this.options.fontSize) return
    this.options.fontSize = fontSize
    this.fail(new Error('Native font changes require xterm fallback'))
    this.fallback?.setFontSize(fontSize)
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unmount()
    this.unlisten?.()
    this.fallback?.dispose()
    this.inputs.clear()
    this.failures.clear()
  }
}

export const createNativeTerminalView = (options: TerminalViewFactoryOptions, port: NativeTerminalPort, fallback: TerminalViewFactory): TerminalView => new NativeTerminalView({ ...options }, port, fallback)
