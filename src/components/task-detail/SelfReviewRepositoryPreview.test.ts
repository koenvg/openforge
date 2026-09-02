import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelfReviewRepositoryPreview from './SelfReviewRepositoryPreview.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SelfReviewRepositoryPreview', () => {
  const scrollIntoView = vi.fn()
  const originalScrollIntoView = Element.prototype.scrollIntoView

  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn())
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('loads only the repository path and applies the fragment after Markdown mounts', async () => {
    const onOpenInFiles = vi.fn().mockResolvedValue(true)
    const fetchContent = vi.fn().mockResolvedValue('# Installation\n\nHistorical instructions')

    render(SelfReviewRepositoryPreview, {
      props: {
        target: {
          repositoryPath: 'docs/SETUP.md',
          suffix: '?plain=1#installation',
        },
        selectedCommitSha: 'commit-sha',
        fetchContent,
        onOpenRepositoryPath: vi.fn(),
        onOpenInFiles,
        onClose: vi.fn(),
      },
    })

    expect(await screen.findByRole('heading', { name: 'Installation' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close repository preview' }))
    expect(fetchContent).toHaveBeenCalledWith('docs/SETUP.md')
    expect(screen.getByText(/Previewing commit commit-s/)).toBeTruthy()
    expect(screen.getByText('Live worktree')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Open docs/SETUP.md in Files' }))
    expect(onOpenInFiles).toHaveBeenCalledWith({
      repositoryPath: 'docs/SETUP.md',
      suffix: '?plain=1#installation',
    })
    expect(screen.getByRole('heading', { name: 'Installation' })).toBeTruthy()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
  })


  it('renders linked image and video files as media instead of encoded text', async () => {
    const imageView = render(SelfReviewRepositoryPreview, {
      props: {
        target: { repositoryPath: 'docs/diagram.png', suffix: '' },
        selectedCommitSha: null,
        fetchContent: vi.fn().mockResolvedValue('aW1hZ2U='),
        onOpenRepositoryPath: vi.fn(),
        onClose: vi.fn(),
      },
    })

    const image = await screen.findByRole('img', { name: 'diagram.png preview' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,aW1hZ2U=')
    imageView.unmount()

    render(SelfReviewRepositoryPreview, {
      props: {
        target: { repositoryPath: 'recordings/demo.mp4', suffix: '' },
        selectedCommitSha: null,
        fetchContent: vi.fn().mockResolvedValue('dmlkZW8='),
        onOpenRepositoryPath: vi.fn(),
        onClose: vi.fn(),
      },
    })

    const video = await screen.findByLabelText('demo.mp4 preview')
    expect(video.getAttribute('src')).toBe('data:video/mp4;base64,dmlkZW8=')
  })
  it('ignores stale loads and retries an error in place', async () => {
    const stale = deferred<string>()
    const failed = deferred<string>()
    const fetchContent = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValueOnce('Recovered content')

    const view = render(SelfReviewRepositoryPreview, {
      props: {
        target: { repositoryPath: 'docs/old.md', suffix: '' },
        selectedCommitSha: null,
        fetchContent,
        onOpenRepositoryPath: vi.fn(),
        onClose: vi.fn(),
      },
    })

    await view.rerender({
      target: { repositoryPath: 'docs/current.txt', suffix: '' },
      selectedCommitSha: null,
      fetchContent,
      onOpenRepositoryPath: vi.fn(),
      onClose: vi.fn(),
    })
    stale.resolve('Stale content')
    failed.reject(new Error('File is unreadable'))

    expect((await screen.findByRole('alert')).textContent).toContain('File is unreadable')
    expect(screen.queryByText('Stale content')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading docs/current.txt' }))
    expect(await screen.findByText('Recovered content')).toBeTruthy()
  })
})
