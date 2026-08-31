import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CopyButton from './CopyButton.svelte'
import { writeClipboardText } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({
  writeClipboardText: vi.fn(),
}))

describe('CopyButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(writeClipboardText).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('cancels its copied-state timer when unmounted', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(CopyButton, {
      props: { text: 'copy me', timeout: 2_000 },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await Promise.resolve()

    expect(writeClipboardText).toHaveBeenCalledWith('copy me')
    const timerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2_000)
    expect(timerIndex).toBeGreaterThanOrEqual(0)
    const copiedStateTimer = setTimeoutSpy.mock.results[timerIndex]?.value

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalledWith(copiedStateTimer)
  })

  it('does not create a copied-state timer when clipboard IPC resolves after unmount', async () => {
    vi.useFakeTimers()
    let resolveClipboardWrite!: () => void
    const clipboardWrite = new Promise<void>((resolve) => {
      resolveClipboardWrite = resolve
    })
    vi.mocked(writeClipboardText).mockReturnValue(clipboardWrite)
    const { unmount } = render(CopyButton, {
      props: { text: 'copy me', timeout: 2_000 },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeClipboardText).toHaveBeenCalledWith('copy me')
    unmount()

    resolveClipboardWrite()
    await clipboardWrite
    await Promise.resolve()

    expect(vi.getTimerCount()).toBe(0)
  })
})
