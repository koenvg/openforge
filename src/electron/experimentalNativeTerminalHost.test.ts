import { describe, expect, it } from 'vitest'
import { ExperimentalNativeTerminalHost, type NativeTerminalAddon, type NativeTerminalWindow } from './experimentalNativeTerminalHost'
import type { NativeTerminalInput, NativeTerminalRequest } from './nativeTerminalProtocol'

function fixture() {
  let callback: Parameters<NativeTerminalAddon['initialize']>[0] = () => {}
  let nextId = 0
  const output: number[] = []
  const released: number[] = []
  const hidden: number[] = []
  const inputs: NativeTerminalInput[] = []
  const addon: NativeTerminalAddon = {
    initialize: listener => { callback = listener },
    create: () => ({ id: ++nextId }),
    inspect: () => ({ columns: 80, rows: 24, cellWidth: 8, cellHeight: 16, terminalColumns: 80, terminalRows: 24 }),
    appendAsync: async (_id, _token, _offset, data) => { output.push(...data) },
    hide: id => { hidden.push(id) },
    destroy: id => { released.push(id); return true },
    setBounds: () => {},
    focus: () => {},
  }
  const window: NativeTerminalWindow = {
    id: 1,
    nativeHandle: () => Buffer.alloc(8),
    scale: () => 2,
    zoom: () => 1,
    size: () => ({ width: 800, height: 600 }),
    sendInput: event => { inputs.push(event) },
    focusWeb: () => {},
  }
  const host = new ExperimentalNativeTerminalHost('T-native-shell-0', () => addon)
  const bounds = { x: 0, y: 0, width: 640, height: 400, visible: false }
  const create = (generation: number) => host.handle(window, { request: {
    operation: 'create', viewId: 'test', generation, terminalKey: 'T-native-shell-0', bounds, fontSize: 13,
  } satisfies NativeTerminalRequest })
  return { host, window, addon, create, bounds, output, released, hidden, inputs, emit: (event: Parameters<typeof callback>[0]) => callback(event) }
}

describe('experimental native terminal IPC ownership', () => {
  it('rejects stale attachments and another window without forwarding bytes or input', async () => {
    const f = fixture()
    const old = await f.create(1) as { id: number }
    const current = await f.create(2) as { id: number }
    const write = { operation: 'write', viewId: 'test', generation: 2, id: current.id, offset: 0, data: new Uint8Array([0, 128, 255]) }
    await expect(f.host.handle({ ...f.window, id: 2 }, { request: write })).rejects.toThrow(/owner/)
    await expect(f.host.handle(f.window, { request: { ...write, generation: 1, id: old.id } })).rejects.toThrow(/stale/i)
    await f.host.handle(f.window, { request: write })
    f.emit({ id: old.id, token: 1, kind: 'input', data: Buffer.from('old') })
    f.emit({ id: current.id, token: 2, kind: 'input', data: Buffer.from('hidden') })
    expect(f.inputs).toEqual([])
    await f.host.handle(f.window, { request: { ...write, operation: 'bounds', bounds: { ...f.bounds, visible: true } } })
    f.emit({ id: current.id, token: 2, kind: 'input', data: Buffer.from([0, 128, 255]) })
    expect(f.output).toEqual([0, 128, 255])
    expect(f.inputs.map(event => [...event.data])).toEqual([[0, 128, 255]])
    f.host.closeWindow(1)
    expect(f.released.sort()).toEqual([old.id, current.id])
    f.emit({ id: current.id, token: 2, kind: 'input', data: Buffer.from('late') })
    expect(f.inputs).toHaveLength(1)
  })
  it('hides immediately while output is pending and rejects hidden input', async () => {
    const f = fixture()
    const current = await f.create(1) as { id: number }
    const owner = { viewId: 'test', generation: 1, id: current.id }
    await f.host.handle(f.window, { request: { ...owner, operation: 'bounds', bounds: { ...f.bounds, visible: true } } })
    let complete!: () => void
    f.addon.appendAsync = () => new Promise(resolve => { complete = resolve })
    const pending = f.host.handle(f.window, { request: { ...owner, operation: 'write', offset: 0, data: new Uint8Array([1]) } })
    await f.host.handle(f.window, { request: { ...owner, operation: 'hide' } })
    expect(f.hidden).toEqual([current.id])
    f.emit({ id: current.id, token: 1, kind: 'input', data: Buffer.from('hidden') })
    expect(f.inputs).toEqual([])
    complete()
    await pending
    f.host.dispose()
  })
})
