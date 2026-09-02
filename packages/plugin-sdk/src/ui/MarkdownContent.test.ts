import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent.svelte'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: mermaid }))

describe('MarkdownContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.dataset.theme = 'openforge'
    document.documentElement.dataset.themeAppearance = 'light'
    mermaid.render.mockResolvedValue({
      svg: '<svg role="img" aria-label="Rendered diagram" style="fill:rgb(1, 2, 3);background-image:url(https://attacker.invalid/pixel)" onload="alert(1)"><style>.node{fill:url(https://attacker.invalid/pixel);stroke:#123}.label{fill:#456}</style><script>alert(1)</script><text>Safe diagram</text></svg>',
    })
  })

  it('renders fenced Mermaid diagrams with strict settings and sanitized SVG output', async () => {
    const { container } = render(MarkdownContent, {
      props: {
        content: '```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```',
      },
    })

    await waitFor(() => {
      expect(container.querySelector('.mermaid-diagram svg')).toBeTruthy()
    })

    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      secure: expect.arrayContaining(['securityLevel', 'theme', 'themeVariables', 'maxTextSize', 'maxEdges']),
      theme: 'default',
    }))
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^openforge-mermaid-/),
      'graph TD\n  A[Start] --> B[Finish]',
    )
    expect(container.querySelector('.mermaid-diagram')?.textContent).toContain('Safe diagram')
    expect(container.querySelector('.mermaid-diagram script')).toBeNull()
    expect(container.querySelector('.mermaid-diagram [onload]')).toBeNull()
    expect(container.querySelector('.mermaid-diagram svg')?.getAttribute('style')).toBe('fill: rgb(1, 2, 3)')
    const stylesheet = container.querySelector('.mermaid-diagram style')?.textContent ?? ''
    expect(stylesheet).not.toContain('url(')
    expect(stylesheet).not.toContain('attacker.invalid')
    expect(stylesheet).toContain('stroke: rgb(17, 34, 51)')
    expect(stylesheet).toContain('fill: rgb(68, 85, 102)')
    expect(container.querySelector('pre')?.hidden).toBe(true)
  })

  it('expands a rendered diagram without changing its inline SVG', async () => {
    const { container } = render(MarkdownContent, {
      props: { content: '```mermaid\ngraph TD\n  A --> B\n```' },
    })

    const expand = await screen.findByRole('button', { name: 'Expand Mermaid diagram' })
    const inlineSvg = container.querySelector('.mermaid-diagram > svg') as SVGSVGElement
    const inlineStyle = inlineSvg.getAttribute('style')

    await fireEvent.click(expand)

    expect(screen.getByRole('dialog', { name: 'Mermaid diagram preview' })).toBeTruthy()
    expect(container.querySelector('.mermaid-diagram > svg')).toBe(inlineSvg)
    expect(inlineSvg.getAttribute('style')).toBe(inlineStyle)
  })

  it('opens the diagram that owns the activated action when Markdown contains several diagrams', async () => {
    mermaid.render.mockImplementation(async (_id, source: string) => {
      const label = source.includes('First') ? 'First diagram' : 'Second diagram'
      return { svg: `<svg role="img" aria-label="${label}" viewBox="0 0 200 100"><text>${label}</text></svg>` }
    })

    render(MarkdownContent, {
      props: {
        content: [
          '```mermaid',
          'graph TD',
          '  First --> A',
          '```',
          '',
          '```mermaid',
          'graph TD',
          '  Second --> B',
          '```',
        ].join('\n'),
      },
    })

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Expand Mermaid diagram' })).toHaveLength(2)
    })
    const expandActions = screen.getAllByRole('button', { name: 'Expand Mermaid diagram' })
    await fireEvent.click(expandActions[1])

    const dialog = screen.getByRole('dialog', { name: 'Mermaid diagram preview' })
    expect(dialog.textContent).toContain('Second diagram')
    expect(dialog.textContent).not.toContain('First diagram')
  })

  it('does not offer expansion for an empty Mermaid fence', async () => {
    render(MarkdownContent, { props: { content: '```mermaid\n\n```' } })

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand Mermaid diagram' })).toBeNull()
  })

  it('keeps the Mermaid source visible when rendering fails', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Invalid diagram'))
    const { container } = render(MarkdownContent, {
      props: { content: '```mermaid\nnot a diagram\n```' },
    })

    expect((await screen.findByRole('status')).textContent).toBe(
      'Unable to render Mermaid diagram. Showing source instead.',
    )
    expect(container.querySelector('.mermaid-diagram-fallback code')?.textContent).toContain('not a diagram')
    expect(container.querySelector('pre')?.hidden).toBe(false)
    expect(container.querySelector('.mermaid-diagram svg')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand Mermaid diagram' })).toBeNull()
  })

  it('rejects Mermaid source that could load an external resource before rendering', async () => {
    render(MarkdownContent, {
      props: {
        content: [
          '```mermaid',
          'stateDiagram-v2',
          '  [*] --> A',
          '  classDef leak fill:url(https://attacker.invalid/pixel),stroke:#333',
          '  class A leak',
          '```',
        ].join('\n'),
      },
    })

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(mermaid.render).not.toHaveBeenCalled()
  })

  it('keeps an explicit light application theme when the system prefers dark', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn(() => ({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      render(MarkdownContent, {
        props: { content: '```mermaid\ngraph TD\n  Light --> Theme\n```' },
      })
      await waitFor(() => expect(mermaid.initialize).toHaveBeenCalled())
      expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('uses explicit appearance instead of theme identifier text and updates while mounted', async () => {
    document.documentElement.dataset.theme = 'vendor:dark-on-paper'
    const content = '```mermaid\ngraph TD\n  Explicit --> Appearance\n```'
    const { rerender } = render(MarkdownContent, {
      props: { content, appearance: 'dark' },
    })

    await waitFor(() => {
      expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
      expect(mermaid.render).toHaveBeenCalledTimes(1)
    })

    await rerender({ content, appearance: 'light' })

    await waitFor(() => {
      expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))
      expect(mermaid.render).toHaveBeenCalledTimes(2)
    })
  })

  it('rerenders Mermaid diagrams when the application theme changes', async () => {
    document.documentElement.dataset.theme = 'vendor:midnight'
    render(MarkdownContent, {
      props: { content: '```mermaid\nsequenceDiagram\n  A->>B: Hello\n```' },
    })

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1))
    document.documentElement.dataset.themeAppearance = 'dark'

    await waitFor(() => {
      expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
      expect(mermaid.render).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps the expanded SVG sanitized', async () => {
    render(MarkdownContent, {
      props: { content: '```mermaid\ngraph TD\n  Safe --> Preview\n```' },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Expand Mermaid diagram' }))
    const dialog = screen.getByRole('dialog', { name: 'Mermaid diagram preview' })

    expect(dialog.querySelector('script')).toBeNull()
    expect(dialog.querySelector('[onload]')).toBeNull()
    expect(dialog.innerHTML).not.toContain('attacker.invalid')
    expect(dialog.textContent).toContain('Safe diagram')
  })

  it('refreshes an open preview after a theme rerender', async () => {
    mermaid.render
      .mockResolvedValueOnce({
        svg: '<svg role="img" aria-label="Light diagram" viewBox="0 0 200 100"><text>Light preview</text></svg>',
      })
      .mockResolvedValueOnce({
        svg: '<svg role="img" aria-label="Dark diagram" viewBox="0 0 200 100"><text>Dark preview</text></svg>',
      })

    render(MarkdownContent, {
      props: { content: '```mermaid\ngraph TD\n  Theme --> Preview\n```' },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Expand Mermaid diagram' }))
    expect(screen.getByRole('dialog', { name: 'Mermaid diagram preview' }).textContent).toContain('Light preview')

    document.documentElement.dataset.themeAppearance = 'dark'

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: 'Mermaid diagram preview' })
      expect(dialog.textContent).toContain('Dark preview')
      expect(dialog.textContent).not.toContain('Light preview')
    })
  })

  it('closes an open preview when Markdown removes its originating diagram', async () => {
    const { rerender } = render(MarkdownContent, {
      props: { content: '```mermaid\ngraph TD\n  Present --> Diagram\n```' },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Expand Mermaid diagram' }))
    await rerender({ content: 'The diagram was removed.' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Mermaid diagram preview' })).toBeNull()
    })
  })

  it('does not restore a preview from a stale asynchronous theme render', async () => {
    let resolveThemeRender!: (value: { svg: string }) => void
    const pendingThemeRender = new Promise<{ svg: string }>((resolve) => {
      resolveThemeRender = resolve
    })
    mermaid.render
      .mockResolvedValueOnce({
        svg: '<svg role="img" aria-label="Current diagram" viewBox="0 0 200 100"><text>Current preview</text></svg>',
      })
      .mockReturnValueOnce(pendingThemeRender)

    const { rerender } = render(MarkdownContent, {
      props: { content: '```mermaid\ngraph TD\n  Current --> Diagram\n```' },
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Expand Mermaid diagram' }))
    document.documentElement.dataset.themeAppearance = 'dark'
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2))

    try {
      await rerender({ content: 'The diagram was removed while rerendering.' })
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Mermaid diagram preview' })).toBeNull()
      })
    } finally {
      resolveThemeRender({
        svg: '<svg role="img" aria-label="Stale diagram" viewBox="0 0 200 100"><text>Stale preview</text></svg>',
      })
    }

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Mermaid diagram preview' })).toBeNull())
  })

  it('resolves nested relative images and keeps missing assets inert', async () => {
    const resolveRepositoryImage = vi.fn(async (path: string) => (
      path === 'docs/assets/diagram.png' ? 'data:image/png;base64,diagram' : null
    ))

    render(MarkdownContent, {
      props: {
        content: [
          '![Diagram](../assets/diagram.png)',
          '![Missing](../assets/missing.png)',
        ].join('\n'),
        markdownFilePath: 'docs/guides/README.md',
        resolveRepositoryImage,
      },
    })

    await waitFor(() => {
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/diagram.png')
      expect(resolveRepositoryImage).toHaveBeenCalledWith('docs/assets/missing.png')
      expect(screen.getByRole('img', { name: 'Diagram' }).getAttribute('src'))
        .toBe('data:image/png;base64,diagram')
    })

    const missingImage = screen.getByRole('img', { name: 'Missing' })
    expect(missingImage.getAttribute('src')).toBeNull()
    expect(missingImage.getAttribute('data-markdown-repository-path')).toBe('docs/assets/missing.png')
  })

  it('swaps in resolved remote images and falls back to the original URL', async () => {
    const resolveRemoteMedia = vi.fn(async (url: string) => (
      url === 'https://github.com/user-attachments/assets/upload-id'
        ? { url: 'https://private-user-images.githubusercontent.com/1/upload-id.png?jwt=signed', kind: 'image' as const }
        : null
    ))

    render(MarkdownContent, {
      props: {
        content: [
          '![Upload](https://github.com/user-attachments/assets/upload-id)',
          '![Badge](https://img.shields.io/badge.svg)',
        ].join('\n'),
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Upload' }).getAttribute('src'))
        .toBe('https://private-user-images.githubusercontent.com/1/upload-id.png?jwt=signed')
    })

    const badge = screen.getByRole('img', { name: 'Badge' })
    expect(badge.getAttribute('src')).toBe('https://img.shields.io/badge.svg')
    expect(badge.hasAttribute('data-markdown-remote-src')).toBe(false)
  })

  it('keeps the original remote image when resolution throws', async () => {
    const resolveRemoteMedia = vi.fn(async () => {
      throw new Error('sidecar unavailable')
    })

    render(MarkdownContent, {
      props: {
        content: '![Upload](https://github.com/user-attachments/assets/upload-id)',
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Upload' }).getAttribute('src'))
        .toBe('https://github.com/user-attachments/assets/upload-id')
    })
  })

  it('turns an uploaded recording into a player and leaves other links alone', async () => {
    const videoUrl = 'https://github.com/user-attachments/assets/recording-id'
    const signedUrl = 'https://private-user-images.githubusercontent.com/1/recording-id.mp4?jwt=signed'
    const resolveRemoteMedia = vi.fn(async (url: string) => (
      url === videoUrl ? { url: signedUrl, kind: 'video' as const } : null
    ))

    const { container } = render(MarkdownContent, {
      props: {
        content: [
          videoUrl,
          '',
          'https://example.com/not-an-upload',
        ].join('\n'),
        resolveRemoteMedia,
      },
    })

    await waitFor(() => {
      expect(container.querySelector('video')).toBeTruthy()
    })

    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBe(signedUrl)
    expect(video.hasAttribute('controls')).toBe(true)
    expect(container.querySelector(`a[href="${videoUrl}"]`)).toBeNull()

    const untouched = screen.getByRole('link', { name: 'https://example.com/not-an-upload' })
    expect(untouched.hasAttribute('data-markdown-remote-src')).toBe(false)
  })

  it('opens repository-relative links separately from external links', async () => {
    const onOpenRepositoryPath = vi.fn()
    const onOpenUrl = vi.fn()

    render(MarkdownContent, {
      props: {
        content: '[Setup](../SETUP.md#installation), [Website](https://example.com/docs), [CDN](//cdn.example.com/guide)',
        markdownFilePath: 'docs/guides/README.md',
        onOpenRepositoryPath,
        onOpenUrl,
      },
    })

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }))
    expect(onOpenRepositoryPath).toHaveBeenCalledWith({
      repositoryPath: 'docs/SETUP.md',
      suffix: '#installation',
    })
    expect(onOpenUrl).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('link', { name: 'Website' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/docs')

    await fireEvent.click(screen.getByRole('link', { name: 'CDN' }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://cdn.example.com/guide')
  })
})
