interface GitHubMarkdownImageBaseParts {
  repo_owner: string
  repo_name: string
  head_sha: string
}

export function getGitHubMarkdownImageBaseUrl(pr: GitHubMarkdownImageBaseParts | null | undefined): string | null {
  if (!pr) return null

  const repoOwner = pr.repo_owner.trim()
  const repoName = pr.repo_name.trim()
  const headSha = pr.head_sha.trim()

  if (!repoOwner || !repoName || !headSha) return null

  return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${headSha}/`
}

function isSafeAttachmentSegment(segment: string): boolean {
  return segment.length > 0 && /^[A-Za-z0-9._-]+$/.test(segment)
}

/**
 * Whether `url` is an image GitHub uploaded for an issue/PR body.
 *
 * These URLs are only servable to an authenticated GitHub *web session*, so an
 * `<img>` in the renderer always fails on them — they have to be exchanged for a
 * signed CDN URL first. Kept deliberately narrow: only paths the sidecar is
 * allowed to hand to the GitHub Markdown API.
 */
export function isGitHubAttachmentUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return false
  if (parsed.search || parsed.hash) return false

  const segments = parsed.pathname.split('/').slice(1)
  if (!segments.every(isSafeAttachmentSegment)) return false

  const [first, second, third] = segments
  if (segments.length === 3) return first === 'user-attachments' && second === 'assets'
  if (segments.length === 5) return third === 'assets'
  return false
}

export function getGitHubMarkdownLinkUrl(
  repoOwner: string,
  repoName: string,
  headSha: string,
  repositoryPath: string,
  suffix = '',
): string | null {
  const baseUrl = getGitHubMarkdownImageBaseUrl({
    repo_owner: repoOwner,
    repo_name: repoName,
    head_sha: headSha,
  })
  if (
    !baseUrl ||
    !repositoryPath ||
    repositoryPath.includes('\\') ||
    repositoryPath.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) return null

  try {
    const repositoryRoot = new URL(`https://github.com/${repoOwner.trim()}/${repoName.trim()}/blob/${headSha.trim()}/`)
    const resolvedUrl = new URL(repositoryPath, repositoryRoot)
    if (resolvedUrl.origin !== repositoryRoot.origin || !resolvedUrl.pathname.startsWith(repositoryRoot.pathname)) return null
    return `${resolvedUrl.href}${suffix}`
  } catch {
    return null
  }
}
