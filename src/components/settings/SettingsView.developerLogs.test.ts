import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSettingsViewDeveloperLogsTest } from './SettingsView.developerLogs.testFixture'
import { defaultProps } from './SettingsView.testUtils'
import { getDeveloperLogSnapshot } from '../../lib/ipc'
import { activeProjectId, projects } from '../../lib/stores'
import SettingsView from './SettingsView.svelte'

describe('SettingsView developer logs integration', () => {
  beforeEach(resetSettingsViewDeveloperLogsTest)

  it('live-refreshes the full OpenForge log trace in the global Developer section', async () => {
    vi.useFakeTimers()
    activeProjectId.set(null)
    projects.set([])
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

    const { unmount } = render(SettingsView, { props: { ...defaultProps, mode: 'global' as const } })

    await fireEvent.click(screen.getByRole('button', { name: /Developer logs/ }))
    try {
      await vi.waitFor(() => {
        expect(screen.getByText('Developer')).toBeTruthy()
        expect(screen.getByText(/\[electron\] app ready/)).toBeTruthy()
      })
      expect(getDeveloperLogSnapshot).toHaveBeenCalledWith(1000)

      await vi.advanceTimersByTimeAsync(1000)

      await vi.waitFor(() => {
        expect(screen.getByText(/\[sidecar\] booted/)).toBeTruthy()
      })
      expect(getDeveloperLogSnapshot).toHaveBeenCalledTimes(2)
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })
})
