import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRenderedMarkdownCache,
  getRenderedMarkdownCacheStats,
  renderMarkdownHtml,
  resolveMarkdownImageSrc,
  resolveMarkdownRepositoryPath,
} from './markdown'

beforeEach(() => {
  clearRenderedMarkdownCache()
})

describe('renderMarkdownHtml', () => {
  it('reuses rendered HTML until the content changes', () => {
    const content = '# Cached prompt'
    const options = { imageBaseUrl: 'https://raw.githubusercontent.com/acme/repo/abc123/' }

    const first = renderMarkdownHtml(content, options)
    const second = renderMarkdownHtml(content, { ...options })
    const changed = renderMarkdownHtml('# Changed prompt', options)

    expect(second).toBe(first)
    expect(changed).not.toBe(first)
    expect(getRenderedMarkdownCacheStats()).toMatchObject({
      size: 2,
      hits: 1,
      misses: 2,
      evictions: 0,
    })
  })

  it('invalidates cached HTML when any media-resolution option changes', () => {
    const content = [
      '![Repository image](../assets/diagram.png)',
      '![Remote image](https://uploads.example.com/diagram.png)',
    ].join('\n')
    const baselineOptions = {
      imageBaseUrl: 'https://cdn.example.com/one/',
      markdownFilePath: 'docs/README.md',
    }

    const baseline = renderMarkdownHtml(content, baselineOptions)
    const changedBaseUrl = renderMarkdownHtml(content, {
      ...baselineOptions,
      imageBaseUrl: 'https://cdn.example.com/two/',
    })
    const changedFilePath = renderMarkdownHtml(content, {
      ...baselineOptions,
      markdownFilePath: 'guides/nested/README.md',
    })
    const deferredRepository = renderMarkdownHtml(content, {
      ...baselineOptions,
      deferRepositoryImages: true,
    })
    const deferredRemote = renderMarkdownHtml(content, {
      ...baselineOptions,
      deferRemoteMedia: true,
    })

    expect(changedBaseUrl).not.toBe(baseline)
    expect(changedFilePath).not.toBe(baseline)
    expect(deferredRepository).toContain('data-markdown-repository-path="assets/diagram.png"')
    expect(deferredRemote).toContain('data-markdown-remote-src="https://uploads.example.com/diagram.png"')
    expect(renderMarkdownHtml(content, baselineOptions)).toBe(baseline)
    expect(getRenderedMarkdownCacheStats()).toMatchObject({ hits: 1, misses: 5, size: 5 })
  })

  it('evicts the least-recently-used rendered HTML at its fixed capacity', () => {
    const { capacity } = getRenderedMarkdownCacheStats()
    for (let index = 0; index < capacity; index++) {
      renderMarkdownHtml(`Entry ${index}`)
    }

    renderMarkdownHtml('Entry 0')
    renderMarkdownHtml('Overflow entry')

    expect(getRenderedMarkdownCacheStats()).toMatchObject({
      capacity,
      size: capacity,
      hits: 1,
      misses: capacity + 1,
      evictions: 1,
    })

    renderMarkdownHtml('Entry 0')
    renderMarkdownHtml('Entry 1')
    expect(getRenderedMarkdownCacheStats()).toMatchObject({
      size: capacity,
      hits: 2,
      misses: capacity + 2,
      evictions: 2,
    })
  })

  it('keeps cached HTML sanitized against scripts, event handlers, and unsafe URLs', () => {
    const content = [
      '<img src="safe.png" onerror="alert(1)">',
      '<script>alert("xss")</script>',
      '<a href="javascript:alert(1)">Unsafe link</a>',
    ].join('\n')

    const first = renderMarkdownHtml(content)
    const cached = renderMarkdownHtml(content)

    expect(cached).toBe(first)
    expect(cached).toContain('<img src="safe.png">')
    expect(cached).not.toContain('<script')
    expect(cached).not.toContain('onerror')
    expect(cached).not.toContain('javascript:')
    expect(getRenderedMarkdownCacheStats()).toMatchObject({ hits: 1, misses: 1 })
  })

  it('wraps tables in a local horizontal scroll container', () => {
    const html = renderMarkdownHtml([
      '| Service | Status |',
      '| --- | --- |',
      '| Search API | Ready |',
    ].join('\n'))
    const template = document.createElement('template')
    template.innerHTML = html

    expect(template.content.querySelector('.markdown-table-scroll > table')).toBeTruthy()
  })

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
