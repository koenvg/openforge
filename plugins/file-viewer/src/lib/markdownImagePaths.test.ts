import { describe, expect, it } from 'vitest'
import { resolveMarkdownImageProjectPath } from './markdownImagePaths'

describe('resolveMarkdownImageProjectPath', () => {
  it('resolves same-directory, parent-directory, and project-root image paths', () => {
    expect(resolveMarkdownImageProjectPath('./diagram.png', 'docs/guides/README.md')).toBe('docs/guides/diagram.png')
    expect(resolveMarkdownImageProjectPath('../assets/logo.png', 'docs/guides/README.md')).toBe('docs/assets/logo.png')
    expect(resolveMarkdownImageProjectPath('/images/root.png', 'docs/guides/README.md')).toBe('images/root.png')
  })

  it('drops markdown query/hash fragments before resolving the project path', () => {
    expect(resolveMarkdownImageProjectPath('diagram%20one.png?raw=true#title', 'docs/README.md')).toBe('docs/diagram one.png')
  })

  it('ignores absolute, special, empty, and project-escaping image sources', () => {
    expect(resolveMarkdownImageProjectPath('https://example.com/a.png', 'docs/README.md')).toBeNull()
    expect(resolveMarkdownImageProjectPath('//cdn.example.com/a.png', 'docs/README.md')).toBeNull()
    expect(resolveMarkdownImageProjectPath('#anchor', 'docs/README.md')).toBeNull()
    expect(resolveMarkdownImageProjectPath('', 'docs/README.md')).toBeNull()
    expect(resolveMarkdownImageProjectPath('../../escape.png', 'docs/README.md')).toBeNull()
  })
})
