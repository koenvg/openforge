import DOMPurify from 'dompurify'

/**
 * Sanitize HTML to prevent XSS attacks.
 * Strips all dangerous tags (script, iframe, etc.) and event handlers.
 * Allows safe structural/formatting HTML through.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style'],
  })
}

const SAFE_MERMAID_STYLE_PROPERTIES = new Set([
  'color',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'max-width',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-align',
  'text-anchor',
  'white-space',
])

function getSafeMermaidStyleDeclarations(style: CSSStyleDeclaration): string[] {
  const safeDeclarations: string[] = []
  for (const property of Array.from(style)) {
    if (!SAFE_MERMAID_STYLE_PROPERTIES.has(property)) continue
    const value = style.getPropertyValue(property)
    if (/url\s*\(|expression\s*\(|javascript:|data:|@import|var\s*\(/i.test(value)) continue
    const priority = style.getPropertyPriority(property)
    safeDeclarations.push(`${property}: ${value}${priority ? ` !${priority}` : ''}`)
  }
  return safeDeclarations
}

function removeCssAtRules(css: string): string {
  let result = ''
  let index = 0

  while (index < css.length) {
    if (css[index] !== '@') {
      result += css[index++]
      continue
    }

    let depth = 0
    let quote = ''
    for (; index < css.length; index++) {
      const character = css[index]
      if (quote) {
        if (character === '\\') index++
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
      } else if (character === '{') {
        depth++
      } else if (character === '}') {
        if (--depth <= 0) {
          index++
          break
        }
      } else if (character === ';' && depth === 0) {
        index++
        break
      }
    }
  }

  return result
}

function sanitizeMermaidStylesheet(css: string, styleParser: HTMLElement): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const safeRuleSource = removeCssAtRules(withoutComments)

  const rules: string[] = []
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let consumedUntil = 0
  let match: RegExpExecArray | null

  while ((match = rulePattern.exec(safeRuleSource)) !== null) {
    if (safeRuleSource.slice(consumedUntil, match.index).trim()) return ''
    consumedUntil = rulePattern.lastIndex

    const selector = match[1].trim()
    if (!selector || /[{}@\\]/.test(selector)) continue
    styleParser.setAttribute('style', match[2])
    const declarations = getSafeMermaidStyleDeclarations(styleParser.style)
    if (declarations.length > 0) rules.push(`${selector} { ${declarations.join('; ')} }`)
  }

  if (safeRuleSource.slice(consumedUntil).trim()) return ''
  return rules.join('\n')
}

function sanitizeMermaidStyles(svg: string): string {
  const template = document.createElement('template')
  template.innerHTML = svg
  const styleParser = document.createElement('span')

  for (const element of template.content.querySelectorAll<HTMLElement>('[style]')) {
    styleParser.setAttribute('style', element.getAttribute('style') ?? '')
    const safeDeclarations = getSafeMermaidStyleDeclarations(styleParser.style)

    if (safeDeclarations.length > 0) {
      element.setAttribute('style', safeDeclarations.join('; '))
    } else {
      element.removeAttribute('style')
    }
  }

  for (const style of template.content.querySelectorAll('style')) {
    const sanitized = sanitizeMermaidStylesheet(style.textContent ?? '', styleParser)
    if (sanitized) {
      style.textContent = sanitized
    } else {
      style.remove()
    }
  }

  return template.innerHTML
}

/** Sanitize generated Mermaid SVG before it is inserted into the document. */
export function sanitizeMermaidSvg(dirty: string): string {
  const sanitized = DOMPurify.sanitize(dirty, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image', 'a'],
    FORBID_ATTR: ['href', 'xlink:href', 'target'],
  })
  return sanitizeMermaidStyles(sanitized)
}
