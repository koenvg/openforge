/**
 * Derives the repository name from a GitHub reference in HTTPS, SSH, or
 * `owner/repo` shorthand form, for the "From GitHub" project-add preview.
 * Returns an empty string when a repo name cannot be derived. The authoritative
 * parse happens in the Rust sidecar; this mirror is display-only.
 */
export function deriveRepoNameFromUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  // Normalize SSH (git@github.com:owner/repo) and scheme prefixes down to the
  // "owner/repo…" tail.
  let rest = trimmed
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')

  const segments = rest.split('/').filter(Boolean)
  if (segments.length < 2) return ''

  const repoSegment = segments[1].split(/[?#]/)[0]
  return repoSegment.replace(/\.git$/i, '')
}
