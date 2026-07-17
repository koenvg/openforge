import { describe, expect, it } from 'vitest'
import { renderMarkdownHtml, resolveMarkdownImageSrc, resolveMarkdownRepositoryPath } from './markdown'

describe('renderMarkdownHtml', () => {
  it('resolves relative image sources against the supplied image base URL', () => {
    const html = renderMarkdownHtml('![Architecture](docs/architecture.png)', {
      imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
    })

    expect(html).toContain('src="https://raw.githubusercontent.com/acme/repo/abc123/docs/architecture.png"')
  })

  it('keeps absolute markdown image sources unchanged', () => {
    const html = renderMarkdownHtml('![Uploaded](https://github.com/user-attachments/assets/image-id)', {
      imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
    })

    expect(html).toContain('src="https://github.com/user-attachments/assets/image-id"')
  })

  it('resolves nested repository paths relative to the Markdown file', () => {
    expect(resolveMarkdownRepositoryPath('../assets/diagram%20one.png?raw=true#preview', 'docs/guides/README.md'))
      .toBe('docs/assets/diagram one.png')
    expect(resolveMarkdownRepositoryPath('/CONTRIBUTING.md', 'docs/guides/README.md')).toBe('CONTRIBUTING.md')
    expect(resolveMarkdownRepositoryPath('../../../escape.png', 'docs/guides/README.md')).toBeNull()
    expect(resolveMarkdownRepositoryPath('..%5C..%5Csecret.png', 'docs/guides/README.md')).toBeNull()
    expect(resolveMarkdownRepositoryPath('?raw=true', 'docs/guides/README.md')).toBeNull()
  })

  it('resolves nested relative images against a repository-root base URL', () => {
    expect(resolveMarkdownImageSrc(
      '../assets/architecture.png',
      'https://raw.githubusercontent.com/acme/repo/abc123/',
      'docs/guides/README.md',
    )).toBe('https://raw.githubusercontent.com/acme/repo/abc123/docs/assets/architecture.png')

    const html = renderMarkdownHtml('![Architecture](../assets/architecture.png)', {
      imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/',
      markdownFilePath: 'docs/guides/README.md',
    })
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/repo/abc123/docs/assets/architecture.png"')
  })

  it('makes rejected relative images inert when repository loading is deferred', () => {
    const html = renderMarkdownHtml('![Escape](../../../escape.png)\n![Encoded](..%5C..%5Csecret.png)', {
      markdownFilePath: 'docs/guides/README.md',
      deferRepositoryImages: true,
    })

    const template = document.createElement('template')
    template.innerHTML = html
    for (const image of template.content.querySelectorAll('img')) {
      expect(image.getAttribute('src')).toBeNull()
      expect(image.hasAttribute('data-markdown-repository-path')).toBe(false)
    }
  })
})
