import { marked, Renderer, type Tokens } from 'marked'
import { sanitizeHtml } from './sanitize'


export interface RenderMarkdownOptions {
  imageBaseUrl?: string | null
  markdownFilePath?: string | null
  deferRepositoryImages?: boolean
  deferRemoteMedia?: boolean
}

/** How a deferred remote URL should be presented once it has been resolved. */
export interface ResolvedMarkdownMedia {
  url: string
  kind: 'image' | 'video'
}

/** Attribute holding the original URL of a `<img>`/`<a>` awaiting resolution. */
export const MARKDOWN_REMOTE_MEDIA_ATTRIBUTE = 'data-markdown-remote-src'

class MarkdownRenderer extends Renderer {
  override table(token: Tokens.Table): string {
    return `<div class="markdown-table-scroll">${super.table(token)}</div>`
  }
}

const markedOptions = {
  gfm: true,
  breaks: true,
  renderer: new MarkdownRenderer(),
}

const RENDERED_MARKDOWN_CACHE_CAPACITY = 100

export interface RenderedMarkdownCacheStats {
  capacity: number
  size: number
  hits: number
  misses: number
  evictions: number
}

const renderedMarkdownCache = new Map<string, string>()
let renderedMarkdownCacheHits = 0
let renderedMarkdownCacheMisses = 0
let renderedMarkdownCacheEvictions = 0

function renderedMarkdownCacheKey(content: string, options: RenderMarkdownOptions): string {
  return JSON.stringify([
    content,
    options.imageBaseUrl ?? null,
    options.markdownFilePath ?? null,
    Boolean(options.deferRepositoryImages),
    Boolean(options.deferRemoteMedia),
  ])
}

function readRenderedMarkdownCache(key: string): string | undefined {
  const cached = renderedMarkdownCache.get(key)
  if (cached === undefined) {
    renderedMarkdownCacheMisses++
    return undefined
  }

  renderedMarkdownCacheHits++
  renderedMarkdownCache.delete(key)
  renderedMarkdownCache.set(key, cached)
  return cached
}

function writeRenderedMarkdownCache(key: string, html: string): void {
  if (renderedMarkdownCache.size >= RENDERED_MARKDOWN_CACHE_CAPACITY) {
    const oldestKey = renderedMarkdownCache.keys().next().value
    if (oldestKey !== undefined) {
      renderedMarkdownCache.delete(oldestKey)
      renderedMarkdownCacheEvictions++
    }
  }

  renderedMarkdownCache.set(key, html)
}

export function getRenderedMarkdownCacheStats(): Readonly<RenderedMarkdownCacheStats> {
  return {
    capacity: RENDERED_MARKDOWN_CACHE_CAPACITY,
    size: renderedMarkdownCache.size,
    hits: renderedMarkdownCacheHits,
    misses: renderedMarkdownCacheMisses,
    evictions: renderedMarkdownCacheEvictions,
  }
}

export function clearRenderedMarkdownCache(): void {
  renderedMarkdownCache.clear()
  renderedMarkdownCacheHits = 0
  renderedMarkdownCacheMisses = 0
  renderedMarkdownCacheEvictions = 0
}
function hasAbsoluteOrSpecialUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#')
}

function decodeMarkdownPath(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

interface MarkdownRepositoryReference {
  pathValue: string
  suffix: string
}

function splitMarkdownRepositoryReference(value: string): MarkdownRepositoryReference {
  const suffixIndex = value.search(/[?#]/)
  return suffixIndex < 0
    ? { pathValue: value, suffix: '' }
    : { pathValue: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) }
}

export function resolveMarkdownRepositoryPath(value: string | null, markdownFilePath: string): string | null {
  if (!value) return null

  const trimmedValue = value.trim()
  if (!trimmedValue || hasAbsoluteOrSpecialUrl(trimmedValue)) return null

  const { pathValue } = splitMarkdownRepositoryReference(trimmedValue)
  if (!pathValue) return null

  const repositoryPath = decodeMarkdownPath(pathValue)
  if (repositoryPath.includes('\\')) return null

  const markdownDirectory = markdownFilePath.split('/').slice(0, -1).join('/')
  const candidate = repositoryPath.startsWith('/')
    ? repositoryPath.slice(1)
    : [markdownDirectory, repositoryPath].filter(Boolean).join('/')
  const parts: string[] = []

  for (const segment of candidate.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }

  return parts.length > 0 ? parts.join('/') : null
}

export function getMarkdownRepositoryLinkSuffix(value: string): string {
  return splitMarkdownRepositoryReference(value.trim()).suffix
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

export function resolveMarkdownImageSrc(
  src: string | null,
  imageBaseUrl: string | null | undefined,
  markdownFilePath = '',
): string | null {
  if (!imageBaseUrl) return null

  const repositoryPath = resolveMarkdownRepositoryPath(src, markdownFilePath)
  if (!repositoryPath) return null

  try {
    return new URL(repositoryPath, withTrailingSlash(imageBaseUrl)).href
  } catch {
    return null
  }
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

const TEXT_NODE = 3

/**
 * Whether nothing but a line break separates `anchor` from the end of its line.
 * GitHub only turns a bare URL into an embedded player when it stands on its own
 * line, so link markup mid-sentence stays a link.
 */
function isAtLineBoundary(from: ChildNode | null, step: 'previousSibling' | 'nextSibling'): boolean {
  let node = from
  while (node) {
    if (node.nodeType !== TEXT_NODE) return node.nodeName === 'BR'
    if ((node.textContent ?? '').trim() !== '') return false
    node = node[step]
  }
  return true
}

function isBareLinkOnItsOwnLine(anchor: Element, href: string): boolean {
  return (anchor.textContent ?? '').trim() === href
    && isAtLineBoundary(anchor.previousSibling, 'previousSibling')
    && isAtLineBoundary(anchor.nextSibling, 'nextSibling')
}

function deferRemoteMediaLinks(root: DocumentFragment): void {
  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (!isRemoteUrl(href) || !isBareLinkOnItsOwnLine(anchor, href)) continue

    anchor.setAttribute(MARKDOWN_REMOTE_MEDIA_ATTRIBUTE, href)
  }
}

function prepareMarkdownMediaSources(
  html: string,
  options: RenderMarkdownOptions,
): string {
  if (
    typeof document === 'undefined' ||
    (!options.imageBaseUrl && !options.deferRepositoryImages && !options.deferRemoteMedia)
  ) return html

  const template = document.createElement('template')
  template.innerHTML = html

  if (options.deferRemoteMedia) {
    deferRemoteMediaLinks(template.content)
  }

  for (const image of template.content.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src')?.trim() ?? ''

    // Hold the remote URL back so the caller can exchange it for one the
    // renderer can actually load, instead of flashing a broken image first.
    if (options.deferRemoteMedia && isRemoteUrl(source)) {
      image.removeAttribute('src')
      image.setAttribute(MARKDOWN_REMOTE_MEDIA_ATTRIBUTE, source)
      continue
    }

    const shouldDefer = options.deferRepositoryImages && source.length > 0 && !hasAbsoluteOrSpecialUrl(source)

    if (shouldDefer) {
      image.removeAttribute('src')
      const repositoryPath = resolveMarkdownRepositoryPath(source, options.markdownFilePath ?? '')
      if (repositoryPath) {
        image.setAttribute('data-markdown-repository-path', repositoryPath)
      }
      continue
    }

    const repositoryPath = resolveMarkdownRepositoryPath(source, options.markdownFilePath ?? '')
    if (!repositoryPath) continue

    const resolvedSrc = resolveMarkdownImageSrc(repositoryPath, options.imageBaseUrl)
    if (resolvedSrc) {
      image.setAttribute('src', resolvedSrc)
    }
  }

  return template.innerHTML
}

export function renderMarkdownHtml(content: string, options: RenderMarkdownOptions = {}): string {
  const cacheKey = renderedMarkdownCacheKey(content, options)
  const cached = readRenderedMarkdownCache(cacheKey)
  if (cached !== undefined) return cached

  const rawHtml = marked.parse(content, markedOptions) as string
  const html = sanitizeHtml(prepareMarkdownMediaSources(rawHtml, options))
  writeRenderedMarkdownCache(cacheKey, html)
  return html
}
