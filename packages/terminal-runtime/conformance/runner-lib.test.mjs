import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import {
  assertPresentation,
  comparePngBuffers,
  summarizeChromiumProcessMemory,
} from './runner-lib.mjs'

function png(colors) {
  const image = new PNG({ width: colors.length, height: 1 })
  colors.forEach(([red, green, blue, alpha], index) => {
    const offset = index * 4
    image.data.set([red, green, blue, alpha], offset)
  })
  return PNG.sync.write(image)
}

describe('terminal presentation harness runner', () => {
  it('asserts text, style, width, and active-buffer semantics without renderer internals', () => {
    const recording = {
      id: 'fixture',
      presentation: {
        textIncludes: ['A界'],
        styledText: { bold: 'A', underline: '界' },
        minimumWideCells: 1,
        activeBuffer: 'alternate',
      },
    }
    const presentation = {
      activeBuffer: 'alternate',
      lines: [{
        text: 'A界',
        cells: [
          { text: 'A', width: 1, bold: true, underline: false },
          { text: '界', width: 2, bold: false, underline: true },
        ],
      }],
    }

    expect(() => assertPresentation(recording, presentation)).not.toThrow()
  })

  it('asserts recorded foreground palette and RGB values semantically', () => {
    const recording = {
      id: 'color',
      presentation: { foregroundText: [{ text: 'red', value: 1 }] },
    }
    const presentation = {
      activeBuffer: 'normal',
      lines: [{
        text: 'red',
        cells: [...'red'].map(text => ({ text, width: 1, foreground: { mode: 16777216, value: 2 } })),
      }],
    }

    expect(() => assertPresentation(recording, presentation)).toThrow('foreground value 1')
  })

  it('applies a bounded visual pixel ratio and returns a diff image', () => {
    const baseline = png([[0, 0, 0, 255], [0, 0, 0, 255]])
    const actual = png([[255, 255, 255, 255], [0, 0, 0, 255]])
    const comparison = comparePngBuffers(baseline, actual, { pixelThreshold: 0.1, maxDiffPixelRatio: 0.5 })

    expect(comparison.diffPixels).toBe(1)
    expect(comparison.diffPixelRatio).toBe(0.5)
    expect(comparison.passed).toBe(true)
    expect(PNG.sync.read(comparison.diff).width).toBe(2)
  })

  it('reports native browser, renderer, and GPU RSS separately from JavaScript heap', () => {
    const rows = [
      { pid: 10, parentPid: 1, rssKiB: 1_000, command: 'chrome' },
      { pid: 11, parentPid: 10, rssKiB: 200, command: 'chrome --type=renderer' },
      { pid: 12, parentPid: 10, rssKiB: 300, command: 'chrome --type=gpu-process' },
      { pid: 13, parentPid: 11, rssKiB: 50, command: 'chrome --type=utility' },
      { pid: 99, parentPid: 1, rssKiB: 9_999, command: 'unrelated' },
    ]

    expect(summarizeChromiumProcessMemory(rows, 10, 123_456)).toEqual({
      available: true,
      browserProcessRssBytes: 1_024_000,
      rendererProcessRssBytes: 204_800,
      gpuProcessRssBytes: 307_200,
      processTreeRssBytes: 1_587_200,
      javascriptHeapUsedBytes: 123_456,
      processCount: 4,
    })
  })
})
