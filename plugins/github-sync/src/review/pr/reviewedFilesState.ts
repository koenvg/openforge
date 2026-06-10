import type { PluginStorageScope } from '@openforge/plugin-sdk/frontend'
import type { PrFileDiff, ReviewPullRequest } from '@openforge/plugin-sdk/domain'
import { getReviewFileIdentity } from '@openforge/pr-review-ui/reviewFileIdentity'

const reviewedFilesStorageKey = 'githubSync.prReview.reviewedFiles.v1'

type PersistedReviewedFiles = Record<string, Array<[string, string]>>

function normalizePersistedReviewedFiles(value: unknown): PersistedReviewedFiles {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const persisted = Object.create(null) as PersistedReviewedFiles
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue
    const normalizedEntries = entries.filter((entry): entry is [string, string] => (
      Array.isArray(entry)
      && entry.length === 2
      && typeof entry[0] === 'string'
      && typeof entry[1] === 'string'
    ))
    if (normalizedEntries.length > 0) {
      persisted[key] = normalizedEntries
    }
  }
  return persisted
}

function areMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left.entries()) {
    if (right.get(key) !== value) return false
  }
  return true
}

async function readPersistedReviewedFiles(scope: PluginStorageScope): Promise<PersistedReviewedFiles> {
  try {
    return normalizePersistedReviewedFiles(await scope.get(reviewedFilesStorageKey))
  } catch {
    return {}
  }
}

async function writePersistedReviewedFiles(scope: PluginStorageScope, persisted: PersistedReviewedFiles): Promise<void> {
  try {
    if (Object.keys(persisted).length === 0) {
      await scope.delete(reviewedFilesStorageKey)
      return
    }
    await scope.set(reviewedFilesStorageKey, persisted)
  } catch {
    // Persistence should not block the review UI when storage is unavailable.
  }
}

export function getPrReviewFilesKey(pr: ReviewPullRequest): string {
  return `${pr.repo_owner}/${pr.repo_name}#${pr.number}`
}

export async function loadPrReviewedFileShas(scope: PluginStorageScope, prKey: string): Promise<Map<string, string>> {
  return new Map((await readPersistedReviewedFiles(scope))[prKey] ?? [])
}

export async function persistPrReviewedFileShas(scope: PluginStorageScope, prKey: string, reviewedFileShas: Map<string, string>): Promise<void> {
  const persisted = await readPersistedReviewedFiles(scope)
  if (reviewedFileShas.size === 0) {
    delete persisted[prKey]
  } else {
    persisted[prKey] = Array.from(reviewedFileShas.entries())
  }
  await writePersistedReviewedFiles(scope, persisted)
}

export function updatePrReviewedFileShas(reviewedFileShas: Map<string, string>, file: PrFileDiff, reviewed: boolean): Map<string, string> {
  const next = new Map(reviewedFileShas)
  if (!reviewed) {
    next.delete(file.filename)
    return next
  }

  const identity = getReviewFileIdentity(file)
  if (identity === null) {
    next.delete(file.filename)
  } else {
    next.set(file.filename, identity)
  }
  return next
}

export function prunePrReviewedFileShas(reviewedFileShas: Map<string, string>, files: PrFileDiff[]): Map<string, string> {
  const currentFileIdentities = new Map(
    files
      .map((file): [string, string | null] => [file.filename, getReviewFileIdentity(file)])
      .filter((entry): entry is [string, string] => entry[1] !== null),
  )
  const next = new Map(reviewedFileShas)

  for (const [filename, identity] of reviewedFileShas.entries()) {
    if (currentFileIdentities.get(filename) !== identity) {
      next.delete(filename)
    }
  }

  return areMapsEqual(reviewedFileShas, next) ? reviewedFileShas : next
}

export function reviewedFileMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  return areMapsEqual(left, right)
}
