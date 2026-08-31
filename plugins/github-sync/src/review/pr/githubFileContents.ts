import type { PrFileDiff, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import {
  getMediaMimeType,
  getVideoMimeType,
  type FileContents,
  type FileRevisionAvailability,
} from '@openforge-app/pr-review-ui/diffAdapter'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

export const MAX_INLINE_VIDEO_PREVIEW_SIZE = 25 * 1024 * 1024

export type GithubFileContentClient = Pick<
  GithubSyncPrReviewClient,
  'getFileContent' | 'getFileContentBase64' | 'getFileAtRef' | 'getFileAtRefBase64'
>

type RevisionResult = {
  content: string
  availability: FileRevisionAvailability
}

function missingRevision(): RevisionResult {
  return { content: '', availability: { status: 'missing' } }
}

function failureRevision(error: unknown): RevisionResult {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === 'string' && error.trim()
      ? error
      : 'Unknown error'
  return { content: '', availability: { status: 'load-failed', message } }
}

function textSize(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

async function loadCurrentRevision(
  client: GithubFileContentClient,
  pr: ReviewPullRequest,
  file: PrFileDiff,
): Promise<RevisionResult> {
  if (file.status === 'removed' || file.status === 'deleted' || !file.sha) return missingRevision()

  try {
    if (getMediaMimeType(file.filename)) {
      const result = await client.getFileContentBase64({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        sha: file.sha,
        maxSize: getVideoMimeType(file.filename) ? MAX_INLINE_VIDEO_PREVIEW_SIZE : undefined,
      })
      return result.tooLarge
        ? { content: '', availability: { status: 'too-large', size: result.size } }
        : { content: result.content, availability: { status: 'available', size: result.size } }
    }

    const content = await client.getFileContent({ owner: pr.repo_owner, repo: pr.repo_name, sha: file.sha })
    return { content, availability: { status: 'available', size: textSize(content) } }
  } catch (error) {
    return failureRevision(error)
  }
}

async function loadOldRevision(
  client: GithubFileContentClient,
  pr: ReviewPullRequest,
  file: PrFileDiff,
): Promise<RevisionResult> {
  if (file.status === 'added') return missingRevision()

  const oldPath = file.previous_filename || file.filename
  try {
    if (getMediaMimeType(oldPath)) {
      const result = await client.getFileAtRefBase64({
        owner: pr.repo_owner,
        repo: pr.repo_name,
        path: oldPath,
        refSha: pr.base_ref,
        maxSize: getVideoMimeType(oldPath) ? MAX_INLINE_VIDEO_PREVIEW_SIZE : undefined,
      })
      return result.tooLarge
        ? { content: '', availability: { status: 'too-large', size: result.size } }
        : { content: result.content, availability: { status: 'available', size: result.size } }
    }

    const content = await client.getFileAtRef({
      owner: pr.repo_owner,
      repo: pr.repo_name,
      path: oldPath,
      refSha: pr.base_ref,
    })
    return { content, availability: { status: 'available', size: textSize(content) } }
  } catch (error) {
    return failureRevision(error)
  }
}

export async function fetchGithubFileContents(
  client: GithubFileContentClient,
  pr: ReviewPullRequest,
  file: PrFileDiff,
): Promise<FileContents> {
  const [oldRevision, newRevision] = await Promise.all([
    loadOldRevision(client, pr, file),
    loadCurrentRevision(client, pr, file),
  ])

  return {
    oldContent: oldRevision.content,
    newContent: newRevision.content,
    oldAvailability: oldRevision.availability,
    newAvailability: newRevision.availability,
  }
}

