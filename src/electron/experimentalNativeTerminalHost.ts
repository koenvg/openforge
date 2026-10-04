import type { NativeTerminalBounds, NativeTerminalIdentity, NativeTerminalInput, NativeTerminalState } from './nativeTerminalProtocol.js'

interface AddonBounds extends NativeTerminalBounds { scale: number; fontSize?: number }
interface AddonInput { id: number; token: number; kind: 'input' | 'error'; data: Uint8Array }
export interface NativeTerminalAddon {
  initialize(listener: (event: AddonInput) => void): void
  create(window: Buffer, token: number, bounds: AddonBounds, snapshot: Buffer): { id: number }
  inspect(id: number): { columns: number; rows: number; cellWidth: number; cellHeight: number; terminalColumns: number; terminalRows: number }
  appendAsync(id: number, token: number, offset: number, data: Buffer): Promise<void>
  setBounds(id: number, bounds: AddonBounds): void
  focus(id: number): void
  hide(id: number): void
  destroy(id: number): boolean
}

/** Only Electron main constructs this port. Renderer payloads never contain a window pointer. */
export interface NativeTerminalWindow {
  id: number
  nativeHandle(): Buffer
  scale(): number
  zoom(): number
  size(): { width: number; height: number }
  sendInput(event: NativeTerminalInput): void
  focusWeb(): void
}
interface Attachment extends NativeTerminalIdentity {
  id: number
  token: number
  window: NativeTerminalWindow
  visible: boolean
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native terminal request')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid native terminal identity or offset')
  return value
}
function identity(value: Record<string, unknown>): NativeTerminalIdentity {
  if (typeof value.viewId !== 'string' || !/^[\w-]{1,80}$/.test(value.viewId)) throw new Error('Invalid native view ID')
  const generation = integer(value.generation)
  if (!generation) throw new Error('Native generation must be positive')
  return { viewId: value.viewId, generation }
}
function bounds(value: unknown, window: NativeTerminalWindow): AddonBounds {
  const input = record(value)
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) throw new Error('Invalid native bounds')
  }
  if (typeof input.visible !== 'boolean') throw new Error('Invalid native visibility')
  const zoom = window.zoom(), scale = window.scale()
  const x = (input.x as number) * zoom, y = (input.y as number) * zoom
  const width = (input.width as number) * zoom, height = (input.height as number) * zoom
  if (width < 1 || height < 1 || width * scale > 16384 || height * scale > 16384) throw new Error('Native bounds exceed limits')
  const size = window.size()
  // A partially clipped DOM terminal must not cover adjacent app chrome.
  const visible = input.visible && x >= 0 && y >= 0 && x + width <= size.width + 1 && y + height <= size.height + 1
  return { x, y, width, height, scale, visible }
}

export class ExperimentalNativeTerminalHost {
  private addon: NativeTerminalAddon | null = null
  private readonly attachments = new Map<number, Attachment>()
  private readonly generations = new Map<number, Map<string, number>>()
  private nextToken = 0

  constructor(private readonly selectedKey: string | null, private readonly loadAddon: () => NativeTerminalAddon) {}

  private native(): NativeTerminalAddon {
    if (!this.addon) {
      const addon = this.loadAddon()
      addon.initialize(event => {
        const attachment = this.attachments.get(event.id)
        if (!attachment || attachment.token !== event.token || !this.current(attachment)) return
        if (event.kind === 'input' && !attachment.visible) return
        attachment.window.sendInput({ ...this.identityOf(attachment), id: attachment.id, kind: event.kind, data: new Uint8Array(event.data) })
      })
      this.addon = addon
    }
    return this.addon
  }

  private identityOf(attachment: Attachment): NativeTerminalIdentity {
    return { viewId: attachment.viewId, generation: attachment.generation }
  }

  private current(attachment: Attachment): boolean {
    return this.generations.get(attachment.window.id)?.get(attachment.viewId) === attachment.generation
  }

  private async readyState(attachment: Attachment): Promise<NativeTerminalState> {
    const deadline = Date.now() + 5000
    while (true) {
      if (this.attachments.get(attachment.id) !== attachment || !this.current(attachment)) throw new Error('Stale native attachment during resize')
      const state = this.native().inspect(attachment.id)
      if (state.columns === state.terminalColumns && state.rows === state.terminalRows) {
        return { id: attachment.id, cols: state.columns, rows: state.rows, cellWidth: state.cellWidth, cellHeight: state.cellHeight }
      }
      if (Date.now() >= deadline) throw new Error('Native terminal resize did not settle')
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  async handle(window: NativeTerminalWindow, payload: unknown): Promise<NativeTerminalState | void> {
    if (!this.selectedKey) throw new Error('Experimental native terminal is disabled')
    const request = record(record(payload).request)
    const owner = identity(request)
    if (request.operation === 'create') {
      if (request.terminalKey !== this.selectedKey) throw new Error('Native terminal is not enabled for this shell')
      const generations = this.generations.get(window.id) ?? new Map<string, number>()
      if (owner.generation <= (generations.get(owner.viewId) ?? 0)) throw new Error('Stale native attachment generation')
      if ((!generations.has(owner.viewId) && generations.size >= 128)
        || [...this.attachments.values()].filter(entry => entry.window.id === window.id).length >= 2) throw new Error('Native attachment limit reached')
      if (typeof request.fontSize !== 'number' || !Number.isFinite(request.fontSize) || request.fontSize < 6 || request.fontSize > 72) throw new Error('Invalid native font size')
      const rect = bounds(request.bounds, window)
      const token = ++this.nextToken
      const native = this.native()
      const { id } = native.create(window.nativeHandle(), token, { ...rect, visible: false, fontSize: request.fontSize * window.zoom() }, Buffer.alloc(0))
      try {
        generations.set(owner.viewId, owner.generation)
        this.generations.set(window.id, generations)
        const attachment: Attachment = { ...owner, id, token, window, visible: false }
        this.attachments.set(id, attachment)
        return await this.readyState(attachment)
      } catch (error) { this.attachments.delete(id); native.destroy(id); throw error }
    }
    const id = integer(request.id)
    const attachment = this.attachments.get(id)
    if (!attachment && request.operation === 'destroy') return
    if (!attachment || attachment.window.id !== window.id || attachment.viewId !== owner.viewId) throw new Error('Native attachment owner mismatch')
    if (attachment.generation !== owner.generation) throw new Error('Stale native attachment generation')
    if (request.operation === 'destroy') {
      this.attachments.delete(id)
      this.native().destroy(id)
      if (attachment.visible) window.focusWeb()
      return
    }
    if (request.operation === 'hide') {
      this.native().hide(id)
      if (attachment.visible) window.focusWeb()
      attachment.visible = false
      return
    }
    if (!this.current(attachment)) throw new Error('Stale native attachment')
    switch (request.operation) {
      case 'write': {
        if (!(request.data instanceof Uint8Array) || request.data.byteLength > 4 * 1024 * 1024) throw new Error('Invalid native output bytes')
        await this.native().appendAsync(id, attachment.token, integer(request.offset), Buffer.from(request.data))
        return
      }
      case 'bounds': {
        const rect = bounds(request.bounds, window)
        this.native().setBounds(id, rect)
        if (attachment.visible && !rect.visible) window.focusWeb()
        attachment.visible = rect.visible
        return this.readyState(attachment)
      }
      case 'focus':
        if (attachment.visible) this.native().focus(id)
        return
      default: throw new Error('Unknown native terminal operation')
    }
  }

  closeWindow(id: number): void {
    for (const attachment of this.attachments.values()) {
      if (attachment.window.id !== id) continue
      this.attachments.delete(attachment.id)
      this.addon?.destroy(attachment.id)
    }
    this.generations.delete(id)
  }

  dispose(): void {
    for (const id of this.generations.keys()) this.closeWindow(id)
  }
}
