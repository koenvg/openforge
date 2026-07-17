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
