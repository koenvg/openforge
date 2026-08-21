import { describe, expect, it } from 'vitest'
import { getGitHubMarkdownLinkUrl, isGitHubAttachmentUrl } from './githubMarkdown'

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

describe('isGitHubAttachmentUrl', () => {
  it('recognises the upload URLs GitHub writes into pull request bodies', () => {
    expect(isGitHubAttachmentUrl('https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3')).toBe(true)
    expect(isGitHubAttachmentUrl('https://github.com/acme/repo/assets/10912932/971f5efc-5e71-4d11-a2b5-daecad5323f3')).toBe(true)
  })

  it('rejects everything the sidecar should not hand to the GitHub markdown API', () => {
    expect(isGitHubAttachmentUrl('https://raw.githubusercontent.com/acme/repo/abc123/docs/diagram.png')).toBe(false)
    expect(isGitHubAttachmentUrl('https://github.com/acme/repo/pull/42')).toBe(false)
    expect(isGitHubAttachmentUrl('https://evil.example.com/user-attachments/assets/971f5efc')).toBe(false)
    expect(isGitHubAttachmentUrl('http://github.com/user-attachments/assets/971f5efc')).toBe(false)
    expect(isGitHubAttachmentUrl('https://github.com/user-attachments/assets/971f5efc?x=1')).toBe(false)
    expect(isGitHubAttachmentUrl('https://github.com/user-attachments/assets/../../secret')).toBe(false)
    expect(isGitHubAttachmentUrl('not a url')).toBe(false)
  })
})
