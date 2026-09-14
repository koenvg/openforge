import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { captureControlStates, compareBaseline, cycleThemes, loadStory, writeJsonArtifact } from './storybook-migration-browser-harness.mjs'

describe('Storybook migration browser harness', () => {
  it('loads a finished story with deterministic browser settings', async () => {
    const page = {
      on: vi.fn((event, listener) => listener(new Error('preview warning'))),
      goto: vi.fn(),
      waitForFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce('finished')
        .mockResolvedValueOnce(undefined),
      addStyleTag: vi.fn(),
    }
    const browser = { newPage: vi.fn().mockResolvedValue(page) }

    const loaded = await loadStory(browser, {
      storybookUrl: 'http://storybook.test',
      story: 'pages-example--default',
      width: 1000,
      locale: 'en-US',
      timezoneId: 'UTC',
    })

    expect(browser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1000, height: 900 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    expect(page.goto).toHaveBeenCalledWith('http://storybook.test/iframe.html?id=pages-example--default&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced')
    expect(page.waitForFunction).toHaveBeenCalledOnce()
    expect(page.addStyleTag).toHaveBeenCalledWith({ content: '* { transition: none !important; }' })
    expect(loaded.page).toBe(page)
    expect(loaded.pageErrors).toEqual(['preview warning'])
  })

  it('cycles themes while preserving and sampling the mounted view', async () => {
    const mounted = { evaluate: vi.fn().mockResolvedValue(true) }
    const selectTheme = vi.fn()
    const sample = vi.fn(async (_page, theme) => ({ paint: theme }))

    await expect(cycleThemes({}, {
      mounted,
      installThemes: vi.fn(),
      themes: ['light', 'dark'],
      selectTheme,
      sample,
    })).resolves.toEqual([
      { theme: 'light', snapshot: { paint: 'light' } },
      { theme: 'dark', snapshot: { paint: 'dark' } },
    ])
    expect(selectTheme.mock.calls.map(([, theme]) => theme)).toEqual(['light', 'dark'])
    expect(mounted.evaluate).toHaveBeenCalledTimes(2)
  })

  it('captures focus, hover and pressed states while always releasing the pointer', async () => {
    const control = {
      evaluate: vi.fn().mockResolvedValue(true),
      focus: vi.fn(),
      hover: vi.fn(),
    }
    const page = {
      keyboard: { press: vi.fn() },
      mouse: { down: vi.fn(), up: vi.fn() },
      evaluate: vi.fn(),
    }
    const sample = vi.fn(async (_page, _control, state) => ({ state }))

    await expect(captureControlStates(page, { control, sample })).resolves.toEqual([
      { state: 'hover' },
      { state: 'pressed' },
      { state: 'focus-visible' },
    ])
    expect(page.mouse.up).toHaveBeenCalledOnce()

    sample.mockImplementation(async (_page, _control, state) => {
      if (state === 'pressed') throw new Error('sampling failed')
      return { state }
    })
    await expect(captureControlStates(page, { control, sample })).rejects.toThrow('sampling failed')
    expect(page.mouse.up).toHaveBeenCalledTimes(2)
  })

  it('compares tolerant baselines and writes newline-terminated artifacts', () => {
    expect(() => compareBaseline(
      { bounds: { width: 10.8 }, paint: 'new', added: true },
      { bounds: { width: 10 }, paint: 'old' },
      'story',
      { tolerance: 1, ignorePath: path => path.endsWith('.paint') },
    )).not.toThrow()
    expect(() => compareBaseline(2, 0, 'story.width', { tolerance: 1 })).toThrow('story.width: 2 vs 0')

    const directory = mkdtempSync(resolve(tmpdir(), 'openforge-storybook-harness-'))
    try {
      const output = resolve(directory, 'nested/report.json')
      writeJsonArtifact(output, { reports: [1] })
      expect(readFileSync(output, 'utf8')).toBe('{\n  "reports": [\n    1\n  ]\n}\n')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
