import { describe, expect, it, vi } from 'vitest'
import { createFakeTerminalView, createHost } from './terminalRuntime.integrationTestHarness'
import { createTerminalRuntime } from './terminalRuntime'
import type { TerminalViewFactoryOptions } from './terminalView'

describe('Terminal Session configuration', () => {
  it('samples host configuration once for each new Terminal Session', async () => {
    const host = createHost()
    const sampledKeys: string[] = []
    host.environment.sampleSessionConfiguration = (shellSessionKey) => {
      sampledKeys.push(shellSessionKey)
      return { renderer: 'xterm', enableImages: shellSessionKey === 'T-2' }
    }
    const viewOptions: TerminalViewFactoryOptions[] = []
    const runtime = createTerminalRuntime({ ...host, createTerminalView: vi.fn((options) => {
      viewOptions.push(options)
      return createFakeTerminalView()
    }), })

    await runtime.acquire('T-1')
    await runtime.acquire('T-1')
    await runtime.acquire('T-2')

    expect(sampledKeys).toEqual(['T-1', 'T-2'])
    expect(viewOptions.map(options => options.enableImages)).toEqual([false, true])
  })
})
