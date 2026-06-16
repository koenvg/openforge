function hasAbsoluteOrSpecialUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#')
}

function decodeImagePath(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

export function resolveMarkdownImageProjectPath(src: string | null, markdownFilePath: string): string | null {
  if (!src) return null

  const trimmedSrc = src.trim()
  if (!trimmedSrc || hasAbsoluteOrSpecialUrl(trimmedSrc)) return null

  const [pathWithoutQueryOrHash] = trimmedSrc.split(/[?#]/, 1)
  const imagePath = decodeImagePath(pathWithoutQueryOrHash)
  const markdownDir = markdownFilePath.split('/').slice(0, -1).join('/')
  const candidate = imagePath.startsWith('/')
    ? imagePath.slice(1)
    : [markdownDir, imagePath].filter(Boolean).join('/')
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
