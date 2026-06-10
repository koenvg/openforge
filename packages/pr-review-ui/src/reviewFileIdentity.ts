export interface ReviewFileIdentityInput {
  filename: string
  sha: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch: string | null
  previous_filename: string | null
  is_truncated: boolean
  patch_line_count: number | null
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function getReviewFileIdentity(file: ReviewFileIdentityInput): string | null {
  const sha = file.sha.trim()
  if (sha.length > 0) return sha

  if (file.patch === null || file.is_truncated) return null

  const contentIdentity = JSON.stringify({
    status: file.status,
    previousFilename: file.previous_filename,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
    isTruncated: file.is_truncated,
    patchLineCount: file.patch_line_count,
  })
  return `diff:${contentIdentity.length}:${hashString(contentIdentity)}`
}
