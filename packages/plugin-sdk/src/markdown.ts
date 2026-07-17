import { marked } from 'marked'
import { sanitizeHtml } from './sanitize'


export interface RenderMarkdownOptions {
  imageBaseUrl?: string | null
  markdownFilePath?: string | null
  deferRepositoryImages?: boolean
}

const markedOptions = {
  gfm: true,
  breaks: true,
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

function prepareMarkdownImageSources(
  html: string,
  options: RenderMarkdownOptions,
): string {
  if (typeof document === 'undefined' || (!options.imageBaseUrl && !options.deferRepositoryImages)) return html

  const template = document.createElement('template')
  template.innerHTML = html

  for (const image of template.content.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src')?.trim() ?? ''
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
  const rawHtml = marked.parse(content, markedOptions) as string
  return sanitizeHtml(prepareMarkdownImageSources(rawHtml, options))
}
