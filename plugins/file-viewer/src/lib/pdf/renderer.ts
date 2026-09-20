import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker } from 'pdfjs-dist'
import type { PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs'

export interface PdfPageResult { pages: number; notice: string; reduced: boolean }
export interface PdfSession {
  load(bytes: Uint8Array, onRender: () => void): Promise<PdfPageResult>
  fit(): Promise<PdfPageResult | undefined>
  destroy(): void
}
const MAX_PIXELS = 16_777_216
const MAX_DIMENSION = 8192
const assetRoot = new URL(/* @vite-ignore */ './pdf-assets/', import.meta.url)

/** Own a real worker explicitly. No PDF URL, scripting manager or annotation layer. */
export function createPdfSession(container: HTMLDivElement, onFailure: (error: Error) => void = () => {}): PdfSession {
  const abort = new AbortController()
  let worker: Worker | null = null
  let workerUrl: string | null = null
  let pdfWorker: PDFWorker | null = null
  let loading: PDFDocumentLoadingTask | null = null
  let document: PDFDocumentProxy | null = null
  let page: PDFPageProxy | null = null
  let view: PDFPageView | null = null
  let viewer: typeof import('pdfjs-dist/web/pdf_viewer.mjs') | null = null
  let result: PdfPageResult | null = null
  let rendering: Promise<PdfPageResult | undefined> | null = null
  let lastWidth = 0
  let disposed = false

  function destroy(): void {
    if (disposed) return
    disposed = true
    abort.abort(new Error('PDF_CANCELLED: preview ended'))
    view?.cancelRendering()
    view?.destroy()
    view = null
    page?.cleanup()
    page = null
    // Ask PDF.js to release pending promises before terminating its transport.
    void loading?.destroy().catch(() => {})
    loading = null
    document = null
    pdfWorker?.destroy()
    pdfWorker = null
    worker?.terminate()
    worker = null
    if (workerUrl) URL.revokeObjectURL(workerUrl)
    workerUrl = null
    for (const canvas of container.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0 }
    container.replaceChildren()
    result = null
  }

  async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(abort.signal.reason)
      if (abort.signal.aborted) { cancel(); return }
      abort.signal.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => reject(new Error('PDF_TIMEOUT: processing deadline exceeded')), milliseconds)
    })
    try { return await Promise.race([work, stopped]) }
    catch (error) { destroy(); throw error }
    finally { clearTimeout(timer); abort.signal.removeEventListener('abort', cancel) }
  }

  async function render(): Promise<PdfPageResult | undefined> {
    if (!document || !page || !viewer || disposed) return
    const width = Math.max(1, container.parentElement?.clientWidth ?? container.clientWidth) - 16
    const base = page.getViewport({ scale: 1 })
    if (![base.width, base.height, width].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('PDF_RESOURCE: invalid page dimensions')
    }
    const scale = Math.max(0.25, Math.min(4, width / (base.width * 96 / 72)))
    const viewport = page.getViewport({ scale: scale * 96 / 72 })
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    const reduced = viewport.width * viewport.height * ratio ** 2 > MAX_PIXELS
      || Math.max(viewport.width, viewport.height) * ratio > MAX_DIMENSION
    view?.destroy()
    container.replaceChildren()
    const eventBus = new viewer.EventBus()
    const textReady = new Promise<void>((resolve, reject) => {
      eventBus.on('textlayerrendered', (event: { error?: unknown }) => event.error ? reject(new Error('PDF_RESOURCE: text layer failed')) : resolve())
    })
    const nextView = new viewer.PDFPageView({
      container, id: 1, scale, defaultViewport: viewport, eventBus,
      annotationMode: 0, textLayerMode: 1,
      enableAutoLinking: false, enableDetailCanvas: false,
      enableSelectionRendering: false, imagesRightClickMinSize: -1,
      maxCanvasPixels: MAX_PIXELS, maxCanvasDim: MAX_DIMENSION,
      capCanvasAreaFactor: -1, abortSignal: abort.signal,
    })
    view = nextView
    nextView.setPdfPage(page)
    const [text, structure] = await Promise.all([
      page.getTextContent(), page.getStructTree(), nextView.draw(), textReady,
    ])
    if (disposed) return
    const hasText = text.items.some(item => 'str' in item && item.str.trim().length > 0)
    // Tagged reading structure lives in the canvas fallback DOM. Do not hide it.
    if (!structure && hasText) nextView.div.querySelector('canvas')?.setAttribute('aria-hidden', 'true')
    for (const canvas of nextView.div.querySelectorAll('canvas')) {
      if (canvas.width > MAX_DIMENSION || canvas.height > MAX_DIMENSION || canvas.width * canvas.height > MAX_PIXELS) {
        throw new Error('PDF_RESOURCE: canvas budget exceeded')
      }
    }
    lastWidth = width
    result = {
      pages: document.numPages, reduced,
      notice: !hasText ? 'No selectable text is available on this page.'
        : !structure ? 'Reading order may differ from the visual page.' : '',
    }
    return result
  }

  async function fit(): Promise<PdfPageResult | undefined> {
    if (!document || !page || disposed) return
    // Resize notifications coalesce; never overlap page renders.
    while (rendering) { await rendering; if (disposed) return }
    const width = Math.max(1, container.parentElement?.clientWidth ?? container.clientWidth) - 16
    if (width === lastWidth && result) return result
    const pending = bounded(render(), 15_000)
    rendering = pending
    try { return await pending }
    finally { if (rendering === pending) rendering = null }
  }

  async function load(bytes: Uint8Array, onRender: () => void): Promise<PdfPageResult> {
    try {
      await bounded((async () => {
        const pdf = await import('pdfjs-dist')
        // pdf_viewer uses the core's public pdfjsLib global; load core first.
        viewer = await import('pdfjs-dist/web/pdf_viewer.mjs')
        if (disposed) throw abort.signal.reason
        workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        try { worker = new Worker(workerUrl, { type: 'module', name: 'project-pdf-preview' }) }
        catch { throw new Error('PDF_WORKER: startup failed') }
        const workerFailed = () => {
          if (disposed) return
          const error = new Error('PDF_WORKER: worker failed')
          abort.abort(error)
          destroy()
          onFailure(error)
        }
        worker.addEventListener('error', workerFailed, { once: true })
        worker.addEventListener('messageerror', workerFailed, { once: true })
        pdfWorker = pdf.PDFWorker.create({ port: worker })
        const options = {
          data: bytes, worker: pdfWorker, isEvalSupported: false, enableXfa: false,
          useSystemFonts: false, useWorkerFetch: true, stopAtErrors: true,
          maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4,
          cMapUrl: new URL('cmaps/', assetRoot).href, cMapPacked: true,
          standardFontDataUrl: new URL('standard_fonts/', assetRoot).href,
          wasmUrl: new URL('wasm/', assetRoot).href, iccUrl: new URL('iccs/', assetRoot).href,
          disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0,
        }
        loading = pdf.getDocument(options)
        document = await loading.promise
        if (document.numPages > 2000) throw new Error('PDF_PAGES: page count')
        page = await document.getPage(1)
      })(), 30_000)
      onRender()
      const rendered = await fit()
      if (!rendered) throw abort.signal.reason ?? new Error('PDF_RESOURCE: page unavailable')
      return rendered
    } catch (error) { destroy(); throw error }
  }
  return { load, fit, destroy }
}
