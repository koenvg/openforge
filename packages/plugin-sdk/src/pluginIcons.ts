import DOMPurify from 'dompurify'

import { isPluginSvgIcon } from './pluginIconContract.js'
import type { PluginIcon } from './types.js'

export const MAX_PLUGIN_SVG_ICON_CHARACTERS = 10_000

const ALLOWED_SVG_TAGS = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']
const ALLOWED_SVG_ATTRIBUTES = [
  'viewBox',
  'd',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
]
const SAFE_PAINT_VALUE = /^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\))$/iu


function parseSvgRoot(markup: string): SVGSVGElement {
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  const children = template.content.children
  const root = children.item(0)

  if (children.length !== 1 || !(root instanceof SVGSVGElement)) {
    throw new TypeError('Custom plugin icons require exactly one <svg> root')
  }

  return root
}

function hasValidViewBox(root: SVGSVGElement): boolean {
  const values = root.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? []
  return values.length === 4
    && values.every(Number.isFinite)
    && (values[2] ?? 0) > 0
    && (values[3] ?? 0) > 0
}

function removeUnsafePaint(root: SVGSVGElement): void {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of ['fill', 'stroke']) {
      const value = element.getAttribute(attribute)
      if (value !== null && !SAFE_PAINT_VALUE.test(value.trim())) {
        element.removeAttribute(attribute)
      }
    }
  }
}

/**
 * Validates and sanitizes a plugin icon before it crosses a host contribution boundary.
 * Named icons are preserved so unsupported names can retain the host's existing fallback.
 */
export function sanitizePluginIcon(icon: unknown): PluginIcon {
  if (typeof icon === 'string') {
    if (icon.trim().length === 0) {
      throw new TypeError('Plugin icon names must be non-empty')
    }
    return icon
  }

  if (!isPluginSvgIcon(icon) || icon.svg.trim().length === 0) {
    throw new TypeError('Plugin icons must be a non-empty name or { type: "svg", svg }')
  }

  if (icon.svg.length > MAX_PLUGIN_SVG_ICON_CHARACTERS) {
    throw new TypeError(`Custom plugin icon SVG must not exceed ${MAX_PLUGIN_SVG_ICON_CHARACTERS.toLocaleString('en-US')} characters`)
  }

  const sanitizedMarkup = DOMPurify.sanitize(icon.svg, {
    ALLOWED_TAGS: ALLOWED_SVG_TAGS,
    ALLOWED_ATTR: ALLOWED_SVG_ATTRIBUTES,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: false,
  })
  const root = parseSvgRoot(sanitizedMarkup)

  if (!hasValidViewBox(root)) {
    throw new TypeError('Custom plugin icons require a viewBox with positive width and height')
  }

  if (!root.querySelector('path, rect, circle, ellipse, line, polyline, polygon')) {
    throw new TypeError('Custom plugin icons require visible geometry')
  }

  root.removeAttribute('width')
  root.removeAttribute('height')
  removeUnsafePaint(root)

  return { type: 'svg', svg: root.outerHTML }
}
