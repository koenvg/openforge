import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import {
  MAX_INLINE_VIDEO_PREVIEW_SIZE,
  fetchGithubFileContents,
  type GithubFileContentClient,
} from './githubFileContents'

const pr = {
  repo_owner: 'acme',
  repo_name: 'widgets',
  base_ref: 'main',
} as ReviewPullRequest

const videoFile: PrFileDiff = {
  sha: 'new-video-sha',
  filename: 'recordings/demo.MP4',
  status: 'modified',
  additions: 0,
  deletions: 0,
  changes: 0,
  patch: null,
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

function makeClient(overrides: Partial<GithubFileContentClient> = {}): GithubFileContentClient {
  return {
    getFileContent: vi.fn(async () => 'new text'),
    getFileContentBase64: vi.fn(async () => ({ content: 'new-video', size: 9, tooLarge: false })),
    getFileAtRef: vi.fn(async () => 'old text'),
    getFileAtRefBase64: vi.fn(async () => ({ content: 'old-video', size: 9, tooLarge: false })),
    ...overrides,
  }
}

describe('fetchGithubFileContents', () => {
  it('loads both revisions of a video as bounded base64 media', async () => {
    const client = makeClient()

    await expect(fetchGithubFileContents(client, pr, videoFile)).resolves.toEqual({
      oldContent: 'old-video',
      newContent: 'new-video',
      oldAvailability: { status: 'available', size: 9 },
      newAvailability: { status: 'available', size: 9 },
    })
    expect(client.getFileContentBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'widgets', sha: 'new-video-sha', maxSize: MAX_INLINE_VIDEO_PREVIEW_SIZE,
    })
    expect(client.getFileAtRefBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'widgets', path: 'recordings/demo.MP4', refSha: 'main', maxSize: MAX_INLINE_VIDEO_PREVIEW_SIZE,
    })
    expect(client.getFileContent).not.toHaveBeenCalled()
    expect(client.getFileAtRef).not.toHaveBeenCalled()
  })

  it('applies media transport and limits to each side of an image-to-video rename', async () => {
    const client = makeClient()
    const file = {
      ...videoFile,
      filename: 'recordings/new.mp4',
      previous_filename: 'assets/old.png',
      status: 'renamed' as const,
    }

    await fetchGithubFileContents(client, pr, file)

    expect(client.getFileContentBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'widgets', sha: 'new-video-sha', maxSize: MAX_INLINE_VIDEO_PREVIEW_SIZE,
    })
    expect(client.getFileAtRefBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'widgets', path: 'assets/old.png', refSha: 'main', maxSize: undefined,
    })
  })

  it('uses text transport for the new side of a video-to-text rename', async () => {
    const client = makeClient()
    const file = {
      ...videoFile,
      filename: 'notes/demo.txt',
      previous_filename: 'recordings/old.mp4',
      status: 'renamed' as const,
    }

    const result = await fetchGithubFileContents(client, pr, file)

    expect(result.newContent).toBe('new text')
    expect(client.getFileContent).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', sha: 'new-video-sha' })
    expect(client.getFileContentBase64).not.toHaveBeenCalled()
    expect(client.getFileAtRefBase64).toHaveBeenCalledWith({
      owner: 'acme', repo: 'widgets', path: 'recordings/old.mp4', refSha: 'main', maxSize: MAX_INLINE_VIDEO_PREVIEW_SIZE,
    })
  })

  it.each([
    ['added', { old: 'missing', new: 'available' }],
    ['removed', { old: 'available', new: 'missing' }],
  ] as const)('marks the absent side of an %s video as missing', async (status, expected) => {
    const client = makeClient()
    const result = await fetchGithubFileContents(client, pr, { ...videoFile, status })

    expect(result.oldAvailability?.status).toBe(expected.old)
    expect(result.newAvailability?.status).toBe(expected.new)
  })

  it('returns a too-large revision without renderer content', async () => {
    const client = makeClient({
      getFileContentBase64: vi.fn(async () => ({ content: '', size: MAX_INLINE_VIDEO_PREVIEW_SIZE + 1, tooLarge: true })),
    })

    const result = await fetchGithubFileContents(client, pr, videoFile)

    expect(result.newContent).toBe('')
    expect(result.newAvailability).toEqual({ status: 'too-large', size: MAX_INLINE_VIDEO_PREVIEW_SIZE + 1 })
  })

  it('keeps revision failures retryable and recovers on the next request', async () => {
    const getFileContentBase64 = vi.fn()
      .mockRejectedValueOnce(new Error('temporary GitHub failure'))
      .mockResolvedValue({ content: 'recovered-video', size: 15, tooLarge: false })
    const client = makeClient({ getFileContentBase64 })

    const failed = await fetchGithubFileContents(client, pr, { ...videoFile, status: 'added' })
    expect(failed.newAvailability).toEqual({ status: 'load-failed', message: 'temporary GitHub failure' })

    const recovered = await fetchGithubFileContents(client, pr, { ...videoFile, status: 'added' })
    expect(recovered.newContent).toBe('recovered-video')
    expect(recovered.newAvailability).toEqual({ status: 'available', size: 15 })
  })
})
