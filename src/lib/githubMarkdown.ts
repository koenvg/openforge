// One source of truth for which upload URLs the sidecar is allowed to resolve.
export { isGitHubAttachmentUrl } from '@openforge-app/pr-review-ui/githubMarkdown'

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
