import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProcessMemoryHistory, setProcessMemoryHistoryEnabled } from '../../lib/ipc'
import SettingsProcessMemoryCard from './SettingsProcessMemoryCard.svelte'

const emptySnapshot = {
  enabled: false,
  sampleIntervalSeconds: 60,
  maxSamples: 60,
  rssSemantics: 'Inclusive process-tree RSS totals can overlap.',
  samples: [],
}

vi.mock('../../lib/ipc', () => ({
  getProcessMemoryHistory: vi.fn(() => Promise.resolve(emptySnapshot)),
  setProcessMemoryHistoryEnabled: vi.fn(() => Promise.resolve({ ...emptySnapshot, enabled: true })),
}))

describe('SettingsProcessMemoryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getProcessMemoryHistory).mockResolvedValue(emptySnapshot)
    vi.mocked(setProcessMemoryHistoryEnabled).mockResolvedValue({ ...emptySnapshot, enabled: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opts into bounded sampling and renders totals-only trends', async () => {
    const enabledSnapshot = {
      ...emptySnapshot,
      enabled: true,
      samples: [
        {
          collectedAt: '2026-07-03T12:00:00Z',
          electronTotalTreeRssBytes: 104_857_600,
          sidecarTotalTreeRssBytes: 52_428_800,
          managedPtyTotalTreeRssBytes: 20_971_520,
          pluginHostTotalTreeRssBytes: 10_485_760,
          trackedUniqueRssBytes: 73_400_320,
        },
      ],
    }
    vi.mocked(setProcessMemoryHistoryEnabled).mockResolvedValue(enabledSnapshot)

    const { unmount } = render(SettingsProcessMemoryCard)
    try {
      const toggle = await screen.findByRole('switch', { name: 'Collect process memory history' })
      expect((toggle as HTMLInputElement).checked).toBe(false)

      await fireEvent.click(toggle)

      expect(setProcessMemoryHistoryEnabled).toHaveBeenCalledWith(true)
      expect((toggle as HTMLInputElement).checked).toBe(true)
      expect(screen.getByText('Electron')).toBeTruthy()
      expect(screen.getByText('100 MB')).toBeTruthy()
      expect(screen.getByRole('img', { name: /Process memory RSS trends/ })).toBeTruthy()
      // Series remain identifiable when a theme assigns the same color to multiple tokens.
      const chart = screen.getByRole('img', { name: /Process memory RSS trends/ })
      const patterns = Array.from(chart.querySelectorAll('polyline'), (line) => line.getAttribute('stroke-dasharray'))
      expect(patterns).toHaveLength(4)
      expect(new Set(patterns).size).toBe(4)
      expect(screen.getByText('1/60 samples')).toBeTruthy()
    } finally {
      unmount()
    }
  })

  it('does not let an older poll overwrite a completed opt-in change', async () => {
    let resolvePoll: ((snapshot: typeof emptySnapshot) => void) | undefined
    vi.mocked(getProcessMemoryHistory)
      .mockResolvedValueOnce(emptySnapshot)
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve }))
    vi.mocked(setProcessMemoryHistoryEnabled).mockResolvedValue({
      ...emptySnapshot,
      enabled: true,
    })

    const { unmount } = render(SettingsProcessMemoryCard)
    try {
      const toggle = await screen.findByRole('switch', { name: 'Collect process memory history' })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(getProcessMemoryHistory).toHaveBeenCalledTimes(2)

      await fireEvent.click(toggle)
      await vi.waitFor(() => expect(setProcessMemoryHistoryEnabled).toHaveBeenCalledWith(true))
      expect((toggle as HTMLInputElement).checked).toBe(true)

      resolvePoll?.(emptySnapshot)
      await Promise.resolve()

      expect((toggle as HTMLInputElement).checked).toBe(true)
    } finally {
      unmount()
    }
  })


  it('stops refreshing after the card is destroyed', async () => {
    const { unmount } = render(SettingsProcessMemoryCard)
    await vi.waitFor(() => expect(getProcessMemoryHistory).toHaveBeenCalledTimes(1))

    unmount()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(getProcessMemoryHistory).toHaveBeenCalledTimes(1)
  })
})
