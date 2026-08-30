import { describe, expect, it, vi } from 'vitest'
import {
  parseNativeProcessRows,
  sampleDesktopProcessMemory,
} from './desktop-test/memory.mjs'

describe('desktop test memory sampling', () => {
  it('parses native process rows and keeps the Electron process tree separate from renderer and GPU RSS', async () => {
    const rows = parseNativeProcessRows([
      '  10  1  1000 pnpm exec electron .',
      '  11 10  2000 Electron .',
      '  12 11   300 Electron Helper (Renderer) --type=renderer',
      '  13 11   400 Electron Helper (GPU) --type=gpu-process',
      '  14 12    50 openforge-sidecar',
      '  99  1  9999 unrelated',
    ].join('\n'))

    const sample = await sampleDesktopProcessMemory({
      rootPid: 10,
      readProcessRows: vi.fn(async () => rows),
      readJavascriptHeapUsedBytes: vi.fn(async () => 123_456),
      now: () => '2025-01-01T00:00:00.000Z',
    })

    expect(sample).toEqual({
      capturedAt: '2025-01-01T00:00:00.000Z',
      native: {
        app: { available: true, bytes: 1_000 * 1024 },
        processTree: { available: true, bytes: 3_750 * 1024 },
        renderer: { available: true, bytes: 300 * 1024 },
        gpu: { available: true, bytes: 400 * 1024 },
      },
      javascriptHeap: { available: true, bytes: 123_456 },
      processCount: 5,
    })
  })

  it('explicitly reports unavailable native and JavaScript heap values', async () => {
    const sample = await sampleDesktopProcessMemory({
      rootPid: null,
      readProcessRows: vi.fn(async () => []),
      readJavascriptHeapUsedBytes: vi.fn(async () => null),
      now: () => '2025-01-01T00:00:00.000Z',
    })

    expect(sample.native.processTree).toEqual({
      available: false,
      bytes: null,
      reason: 'Electron process information is unavailable',
    })
    expect(sample.native.app).toEqual(sample.native.processTree)
    expect(sample.native.renderer).toEqual(sample.native.processTree)
    expect(sample.native.gpu).toEqual(sample.native.processTree)
    expect(sample.javascriptHeap).toEqual({
      available: false,
      bytes: null,
      reason: 'JavaScript heap information is unavailable',
    })
    expect(sample.processCount).toBe(0)
  })

  it('marks missing renderer and GPU process classes unavailable without discarding process-tree RSS', async () => {
    const sample = await sampleDesktopProcessMemory({
      rootPid: 10,
      readProcessRows: vi.fn(async () => [
        { pid: 10, parentPid: 1, rssKiB: 100, command: 'electron-main' },
      ]),
      readJavascriptHeapUsedBytes: vi.fn(async () => 1),
    })

    expect(sample.native.processTree).toEqual({ available: true, bytes: 102_400 })
    expect(sample.native.app).toEqual({ available: true, bytes: 102_400 })
    expect(sample.native.renderer).toMatchObject({ available: false, bytes: null })
    expect(sample.native.gpu).toMatchObject({ available: false, bytes: null })
  })
})
