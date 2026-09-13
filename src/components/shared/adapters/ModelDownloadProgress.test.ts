import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
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

  it('names the download progress without adding a duplicate live announcement', async () => {
    vi.mocked(listenDesktopEvent).mockResolvedValue(vi.fn())
    vi.mocked(downloadWhisperModel).mockReturnValue(new Promise(() => {}))

    render(ModelDownloadProgress, { modelSize: 'small', modelDisplayName: 'Small', diskSizeMb: 466 })
    await tick()

    const bar = screen.getByRole('progressbar', { name: 'Downloading Whisper Small' })
    expect(bar).toHaveAttribute('max', '100')
    expect(bar).toHaveAttribute('value', '0')
    expect(screen.getByText('Preparing download...')).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows matching model progress, completes once, and retains retry after failure', async () => {
    const onComplete = vi.fn()
    const onError = vi.fn()
    vi.mocked(listenDesktopEvent).mockResolvedValue(vi.fn())
    let rejectDownload!: (error: Error) => void
    vi.mocked(downloadWhisperModel).mockReturnValueOnce(new Promise((_, reject) => { rejectDownload = reject }))
    render(ModelDownloadProgress, { modelSize: 'small', modelDisplayName: 'Small', diskSizeMb: 466, onComplete, onError })
    await tick()
    const notify = vi.mocked(listenDesktopEvent).mock.calls[0][1]
    const emit = (model: string, percentage: number) => notify({ payload: { model_size: model, percentage, bytes_downloaded: 1048576, total_bytes: 4194304 } } as never)
    emit('large', 75)
    await tick()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
    emit('small', 25)
    await tick()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '25')
    expect(screen.getByText('25% — 1 MB / 4 MB')).toBeVisible()
    rejectDownload(new Error('network unavailable'))
    await tick()
    expect(await screen.findByText('Failed to download model. Please try again.')).toBeVisible()
    expect(onError).toHaveBeenCalledWith('Failed to download model. Please try again.')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await tick()
    expect(screen.getByText('Small downloaded')).toBeVisible()
    expect(screen.getByText('Ready')).toBeVisible()
    emit('small', 100)
    await tick()
    expect(onComplete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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
