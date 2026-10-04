import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalViewFactoryOptions } from '@openforge-app/terminal-runtime'
import { createFakeTerminalView } from '@openforge-app/terminal-runtime/testUtils'
import { createNativeTerminalView, type NativeTerminalPort } from './nativeTerminalView'
import type { NativeTerminalInput } from '../electron/nativeTerminalProtocol'

const options: TerminalViewFactoryOptions = {
  terminalKey: 'T-native-shell-0', themeMode: 'dark', fontSize: 13,
  fontReadiness: { status: 'ready' }, openLink: async () => {},
}

afterEach(() => { document.body.replaceChildren() })

describe('native Terminal Runtime view adapter', () => {
  it('restores portable VT before later output and accepts only current attachment input', async () => {
    let nextId = 0
    let input: (event: NativeTerminalInput) => void = () => {}
    const created: Array<{ id: number; viewId: string; generation: number }> = []
    const received: number[] = []
    const destroyed: number[] = []
    const visibility: boolean[] = []
    const port: NativeTerminalPort = {
      create: async request => {
        const entry = { id: ++nextId, viewId: request.viewId, generation: request.generation }
        created.push(entry)
        return { ...entry, cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 }
      },
      write: async request => { received.push(...request.data) },
      bounds: async request => { visibility.push(request.bounds.visible); return { id: request.id, cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 } },
      hide: async () => { visibility.push(false) },
      focus: async () => {},
      destroy: async request => { destroyed.push(request.id) },
      onInput: async listener => { input = listener; return () => {} },
    }
    const view = createNativeTerminalView(options, port, () => createFakeTerminalView())
    const host = document.createElement('div')
    document.body.append(host)
    view.mount(host)
    vi.spyOn(view.resizeTarget, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 400))
    view.setVisible(true)
    await view.prepare?.()
    const userInput: Array<string | Uint8Array> = []
    view.onUserInput(data => userInput.push(data))
    await view.replaceSnapshot({ data: 'SNAP', compatibilityData: 'COMPAT', continuationData: new Uint8Array([27, 91]), ptyInstanceId: 7, sequence: 0 })
    view.writeLive({ data: '31mLIVE', ptyInstanceId: 7, sequence: 1 })
    view.writeLive({ data: 'STALE', ptyInstanceId: 6, sequence: 2 })
    await vi.waitFor(() => expect(new TextDecoder().decode(new Uint8Array(received))).toBe('SNAPCOMPAT\x1b[31mLIVE'))
    input({ ...created[0], kind: 'input', data: new Uint8Array([1]) })
    input({ ...created.at(-1)!, kind: 'input', data: new Uint8Array([0, 128, 255]) })
    expect(userInput).toEqual([new Uint8Array([0, 128, 255])])
    expect(visibility.at(-1)).toBe(true)
    let complete!: () => void
    const started = new Promise<void>(resolve => {
      port.write = () => new Promise(done => { complete = done; resolve() })
    })
    view.writeLive({ data: 'PENDING', ptyInstanceId: 7, sequence: 2 })
    await started
    view.invalidateSnapshot()
    try { await vi.waitFor(() => expect(visibility.at(-1)).toBe(false)) } finally { complete() }
    view.unmount()
    input({ ...created.at(-1)!, kind: 'input', data: new Uint8Array([2]) })
    await vi.waitFor(() => expect(destroyed.sort()).toEqual(created.map(entry => entry.id).sort()))
    expect(userInput).toHaveLength(1)
    view.dispose()
  })
  it('falls back and requests authority recovery instead of buffering unlimited output', async () => {
    const fallback = vi.fn(() => createFakeTerminalView())
    let complete!: () => void
    let started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    const port: NativeTerminalPort = {
      create: async () => ({ id: 1, cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 }),
      bounds: async () => ({ id: 1, cols: 80, rows: 24, cellWidth: 8, cellHeight: 16 }),
      write: () => new Promise(resolve => { complete = resolve; started() }),
      hide: async () => {}, focus: async () => {}, destroy: async () => {}, onInput: async () => () => {},
    }
    const view = createNativeTerminalView(options, port, fallback)
    const host = document.createElement('div')
    document.body.append(host)
    view.mount(host)
    vi.spyOn(view.resizeTarget, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 400))
    view.setVisible(true)
    await view.replaceSnapshot({ data: '', ptyInstanceId: 7, sequence: 0 })
    const failed = vi.fn()
    view.onRendererFailure(failed)
    view.writeLive({ data: new Uint8Array(4 * 1024 * 1024), ptyInstanceId: 7, sequence: 1 })
    await began
    try {
      view.writeLive({ data: 'overflow', ptyInstanceId: 7, sequence: 2 })
      expect(fallback).toHaveBeenCalledOnce()
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ requiresRecovery: true }))
    } finally { complete(); view.dispose() }
  })
})
