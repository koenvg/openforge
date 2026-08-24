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

  it('holds back absolute image sources when remote media loading is deferred', () => {
    const html = renderMarkdownHtml(
      '![Uploaded](https://github.com/user-attachments/assets/image-id)\n<img src="data:image/png;base64,inline" alt="Inline">',
      { deferRemoteMedia: true },
    )

    const template = document.createElement('template')
    template.innerHTML = html

    const uploaded = template.content.querySelector('img[alt="Uploaded"]')!
    expect(uploaded.getAttribute('src')).toBeNull()
    expect(uploaded.getAttribute('data-markdown-remote-src')).toBe('https://github.com/user-attachments/assets/image-id')

    const inline = template.content.querySelector('img[alt="Inline"]')!
    expect(inline.getAttribute('src')).toBe('data:image/png;base64,inline')
    expect(inline.hasAttribute('data-markdown-remote-src')).toBe(false)
  })

  it('marks bare links that sit on their own line, the way uploads are written', () => {
    const html = renderMarkdownHtml([
      'https://github.com/user-attachments/assets/alone-in-paragraph',
      '',
      'Recorded it here:',
      'https://github.com/user-attachments/assets/after-a-line-break',
      '',
      'See https://github.com/user-attachments/assets/inline-in-a-sentence for details.',
      '',
      '[Named link](https://github.com/user-attachments/assets/named)',
    ].join('\n'), { deferRemoteMedia: true })

    const template = document.createElement('template')
    template.innerHTML = html
    const marked = Array.from(template.content.querySelectorAll('a[data-markdown-remote-src]'))
      .map((anchor) => anchor.getAttribute('data-markdown-remote-src'))

    expect(marked).toEqual([
      'https://github.com/user-attachments/assets/alone-in-paragraph',
      'https://github.com/user-attachments/assets/after-a-line-break',
    ])
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
