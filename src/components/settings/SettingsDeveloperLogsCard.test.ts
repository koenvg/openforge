import { render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { getDeveloperLogSnapshot } from '../../lib/ipc'
import SettingsDeveloperLogsCard from './SettingsDeveloperLogsCard.svelte'

vi.mock('../../lib/ipc', () => ({
  getDeveloperLogSnapshot: vi.fn(() => Promise.resolve({ entries: [], logFilePath: '/tmp/openforge.log', totalEntries: 0 })),
  openInEditor: vi.fn(() => Promise.resolve(undefined)),
}))

describe('SettingsDeveloperLogsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 100
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.textContent?.includes('[sidecar] booted') ? 300 : 200
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight
    delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
  })

  it('scrolls the log trace to the bottom after the initial snapshot renders', async () => {
    vi.mocked(getDeveloperLogSnapshot).mockResolvedValueOnce({
      entries: [
        {
          id: 1,
          timestamp: '2026-07-03T12:00:00.000Z',
          level: 'info',
          message: '[electron] app ready',
        },
      ],
      logFilePath: '/tmp/openforge.log',
      totalEntries: 1,
    })

    const { unmount } = render(SettingsDeveloperLogsCard)

    try {
      const trace = requireElement(await screen.findByLabelText('OpenForge log trace'), HTMLPreElement)

      await vi.waitFor(() => {
        expect(trace.scrollTop).toBeGreaterThanOrEqual(trace.scrollHeight - trace.clientHeight)
      })
    } finally {
      unmount()
    }
  })

  it('keeps the log trace pinned to the bottom when refreshed while already at the bottom', async () => {
    vi.mocked(getDeveloperLogSnapshot)
      .mockResolvedValueOnce({
        entries: [
          {
            id: 1,
            timestamp: '2026-07-03T12:00:00.000Z',
            level: 'info',
            message: '[electron] app ready',
          },
        ],
        logFilePath: '/tmp/openforge.log',
        totalEntries: 1,
      })
      .mockResolvedValueOnce({
        entries: [
          {
            id: 1,
            timestamp: '2026-07-03T12:00:00.000Z',
            level: 'info',
            message: '[electron] app ready',
          },
          {
            id: 2,
            timestamp: '2026-07-03T12:00:01.000Z',
            level: 'info',
            message: '[sidecar] booted',
          },
        ],
        logFilePath: '/tmp/openforge.log',
        totalEntries: 2,
      })

    const { unmount } = render(SettingsDeveloperLogsCard)

    try {
      const trace = requireElement(await screen.findByLabelText('OpenForge log trace'), HTMLPreElement)

      await vi.waitFor(() => {
        expect(trace.scrollTop).toBeGreaterThanOrEqual(100)
      })

      trace.scrollTop = trace.scrollHeight - trace.clientHeight
      await vi.advanceTimersByTimeAsync(1000)

      await vi.waitFor(() => {
        expect(screen.getByText(/\[sidecar\] booted/)).toBeTruthy()
        expect(trace.scrollTop).toBeGreaterThanOrEqual(trace.scrollHeight - trace.clientHeight)
      })
    } finally {
      unmount()
    }
  })
})
