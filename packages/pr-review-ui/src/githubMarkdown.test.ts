import { describe, expect, it } from 'vitest'
import { getGitHubMarkdownLinkUrl } from './githubMarkdown'

describe('getGitHubMarkdownLinkUrl', () => {
  it('preserves Markdown link suffixes inside the pull request head tree', () => {
    expect(getGitHubMarkdownLinkUrl('acme', 'repo', 'abc123', 'docs/SETUP.md', '#installation'))
      .toBe('https://github.com/acme/repo/blob/abc123/docs/SETUP.md#installation')
  })

  it('rejects paths that could escape the repository URL root', () => {
    expect(getGitHubMarkdownLinkUrl('acme', 'repo', 'abc123', '../secret.md')).toBeNull()
    expect(getGitHubMarkdownLinkUrl('acme', 'repo', 'abc123', '\\evil.com\\secret.md')).toBeNull()
    expect(getGitHubMarkdownLinkUrl('acme', 'repo', 'abc123', 'docs//secret.md')).toBeNull()
  })
})
