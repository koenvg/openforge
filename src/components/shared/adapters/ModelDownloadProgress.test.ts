import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelDownloadProgress from './ModelDownloadProgress.svelte'
import { listenDesktopEvent, type DesktopUnlistenFn } from '../../../lib/desktopIpc'
import { downloadWhisperModel } from '../../../lib/ipc'

vi.mock('../../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn(),
}))

vi.mock('../../../lib/ipc', () => ({
  downloadWhisperModel: vi.fn(),
}))

describe('ModelDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(downloadWhisperModel).mockResolvedValue(undefined)
  })

  it('releases a Whisper progress listener that finishes registering after unmount', async () => {
    let resolveListener!: (unlisten: DesktopUnlistenFn) => void
    const listenerRegistration = new Promise<DesktopUnlistenFn>((resolve) => {
      resolveListener = resolve
    })
    const unlisten = vi.fn()
    vi.mocked(listenDesktopEvent).mockReturnValue(listenerRegistration)

    const { unmount } = render(ModelDownloadProgress, {
      props: {
        modelSize: 'small',
        modelDisplayName: 'Small',
        diskSizeMb: 466,
      },
    })

    expect(listenDesktopEvent).toHaveBeenCalledWith('whisper-download-progress', expect.any(Function))
    unmount()

    resolveListener(unlisten)
    await listenerRegistration
    await tick()

    expect(unlisten).toHaveBeenCalledOnce()
    expect(downloadWhisperModel).not.toHaveBeenCalled()
  })
})
