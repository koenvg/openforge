import { sanitizeMermaidSvg } from './sanitize'

export type MermaidTheme = 'default' | 'dark'

type MermaidApi = Pick<(typeof import('mermaid'))['default'], 'initialize' | 'render'>

const MERMAID_CODE_SELECTOR = 'pre > code.language-mermaid'
const MERMAID_DIAGRAM_CLASS = 'mermaid-diagram'
const MERMAID_FAILURE_CLASS = 'mermaid-diagram-fallback'
const MERMAID_EXTERNAL_RESOURCE_PATTERN = /(?:\b(?:https?|ftp|file|data|javascript|vbscript):|(?:^|[\s("'=])\/\/|@import|\burl\s*\()/im
const MERMAID_ESCAPED_STYLE_PATTERN = /\b(?:classDef|style|linkStyle)\b[^\r\n]*\\/i

let diagramId = 0
let renderQueue: Promise<void> = Promise.resolve()

interface MermaidThemeObservation {
  listeners: Set<() => void>
  observer: MutationObserver
  media: MediaQueryList | undefined
  notify: () => void
}

const mermaidThemeObservations = new WeakMap<Document, MermaidThemeObservation>()

function loadMermaid(): Promise<MermaidApi> {
  return import('mermaid').then(module => module.default)
}

export function resolveMermaidTheme(doc: Document = document): MermaidTheme {
  const themeName = doc.documentElement.getAttribute('data-theme')
  if (themeName) return themeName.includes('dark') ? 'dark' : 'default'

  if (doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'default'
}

function queueMermaidRender<T>(operation: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(operation, operation)
  renderQueue = result.then(() => undefined, () => undefined)
  return result
}

function assertSafeMermaidSource(source: string): void {
  if (MERMAID_EXTERNAL_RESOURCE_PATTERN.test(source) || MERMAID_ESCAPED_STYLE_PATTERN.test(source)) {
    throw new Error('Mermaid source contains an external resource')
  }
}

async function renderMermaidSvg(source: string, theme: MermaidTheme): Promise<string> {
  assertSafeMermaidSource(source)
  return queueMermaidRender(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'suppressErrorRendering',
        'maxTextSize',
        'maxEdges',
        'theme',
        'themeVariables',
        'themeCSS',
        'fontFamily',
        'altFontFamily',
        'dompurifyConfig',
        'htmlLabels',
        'flowchart',
      ],
      theme,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    })
    const { svg } = await mermaid.render(`openforge-mermaid-${++diagramId}`, source)
    return sanitizeMermaidSvg(svg)
  })
}

function prepareDiagram(code: HTMLElement): { wrapper: HTMLDivElement, source: string, fallback: HTMLPreElement } | null {
  const fallback = code.parentElement
  if (!(fallback instanceof HTMLPreElement)) return null

  const existingWrapper = fallback.parentElement
  if (existingWrapper instanceof HTMLDivElement && existingWrapper.classList.contains(MERMAID_DIAGRAM_CLASS)) {
    return { wrapper: existingWrapper, source: code.textContent?.trim() ?? '', fallback }
  }

  const wrapper = document.createElement('div')
  wrapper.className = MERMAID_DIAGRAM_CLASS
  wrapper.setAttribute('role', 'group')
  wrapper.setAttribute('aria-label', 'Mermaid diagram')
  fallback.before(wrapper)
  wrapper.append(fallback)
  return { wrapper, source: code.textContent?.trim() ?? '', fallback }
}

function clearRenderedDiagram(wrapper: HTMLDivElement, fallback: HTMLPreElement): void {
  for (const child of Array.from(wrapper.children)) {
    if (child !== fallback) child.remove()
  }
  fallback.hidden = false
  wrapper.classList.remove('mermaid-diagram-rendered', MERMAID_FAILURE_CLASS)
}

function showRenderFailure(wrapper: HTMLDivElement, fallback: HTMLPreElement): void {
  clearRenderedDiagram(wrapper, fallback)
  const message = document.createElement('p')
  message.className = 'mermaid-diagram-error'
  message.setAttribute('role', 'status')
  message.textContent = 'Unable to render Mermaid diagram. Showing source instead.'
  wrapper.prepend(message)
  wrapper.classList.add(MERMAID_FAILURE_CLASS)
}
function fitSvgToRenderedContent(svg: SVGSVGElement): void {
  if (typeof svg.getBBox !== 'function') return

  try {
    const bounds = svg.getBBox()
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return
    if (bounds.width <= 0 || bounds.height <= 0) return

    const padding = 8
    const width = bounds.width + padding * 2
    const height = bounds.height + padding * 2
    svg.setAttribute('viewBox', [
      bounds.x - padding,
      bounds.y - padding,
      width,
      height,
    ].join(' '))
    svg.style.maxWidth = `${Math.ceil(width)}px`
  } catch {
    // Keep Mermaid's original viewport when the browser cannot measure SVG geometry.
  }
}


function showRenderedDiagram(wrapper: HTMLDivElement, fallback: HTMLPreElement, sanitizedSvg: string): boolean {
  const template = document.createElement('template')
  template.innerHTML = sanitizedSvg
  const svg = template.content.querySelector('svg') as SVGSVGElement | null
  if (!svg) return false

  if (!svg.hasAttribute('role')) svg.setAttribute('role', 'img')
  if (!svg.hasAttribute('aria-label') && !svg.hasAttribute('aria-labelledby')) {
    svg.setAttribute('aria-label', 'Mermaid diagram')
  }

  clearRenderedDiagram(wrapper, fallback)
  wrapper.insertBefore(template.content, fallback)
  fitSvgToRenderedContent(svg)
  fallback.hidden = true
  wrapper.classList.add('mermaid-diagram-rendered')
  return true
}

export async function renderMermaidDiagrams(
  root: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_CODE_SELECTOR))
    .map(prepareDiagram)
    .filter((diagram): diagram is NonNullable<typeof diagram> => diagram !== null)
  const theme = resolveMermaidTheme(root.ownerDocument)

  await Promise.all(diagrams.map(async ({ wrapper, source, fallback }) => {
    clearRenderedDiagram(wrapper, fallback)
    if (!source) {
      showRenderFailure(wrapper, fallback)
      return
    }

    try {
      const svg = await renderMermaidSvg(source, theme)
      if (!isCurrent() || !wrapper.isConnected) return
      if (!showRenderedDiagram(wrapper, fallback, svg)) showRenderFailure(wrapper, fallback)
    } catch {
      if (isCurrent() && wrapper.isConnected) showRenderFailure(wrapper, fallback)
    }
  }))
}

export function observeMermaidTheme(doc: Document, onChange: () => void): () => void {
  let observation = mermaidThemeObservations.get(doc)
  if (!observation) {
    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach(listener => listener())
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(mutation => mutation.attributeName === 'data-theme')) notify()
    })
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const media = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', notify)
    observation = { listeners, observer, media, notify }
    mermaidThemeObservations.set(doc, observation)
  }

  observation.listeners.add(onChange)
  return () => {
    observation.listeners.delete(onChange)
    if (observation.listeners.size > 0) return

    observation.observer.disconnect()
    observation.media?.removeEventListener?.('change', observation.notify)
    mermaidThemeObservations.delete(doc)
  }
}
