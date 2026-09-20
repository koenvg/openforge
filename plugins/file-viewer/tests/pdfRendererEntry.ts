import 'pdfjs-dist/web/pdf_viewer.css'
import { createPdfSession } from '../src/lib/pdf/renderer'
import { mountPdfViewer } from './pdfViewerFixture'

// Instrument real browser resources; all successful previews still use the real worker.
const resources = { active: 0, peak: 0, created: 0, urls: 0, mode: '' }
let failWorker = () => {}
const NativeWorker = globalThis.Worker
class TrackedWorker extends NativeWorker {
  private ended = false
  constructor(url: string | URL, options?: WorkerOptions) {
    if (resources.mode === 'startup-failure') throw new Error('Test worker startup failure')
    super(url, options)
    resources.created++
    failWorker = () => this.dispatchEvent(new Event('error'))
    resources.active++
    resources.peak = Math.max(resources.peak, resources.active)
  }
  postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]): void {
    const action = (message as { action?: string })?.action
    if (resources.mode === 'parse-timeout' || (resources.mode === 'render-timeout' && (action === 'GetOperatorList' || action === 'GetTextContent'))) return
    if (Array.isArray(options)) super.postMessage(message, options)
    else super.postMessage(message, options)
  }
  terminate(): void {
    if (!this.ended) { this.ended = true; resources.active-- }
    super.terminate()
  }
}
globalThis.Worker = TrackedWorker
const createUrl = URL.createObjectURL.bind(URL)
const revokeUrl = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { resources.urls++; return createUrl(blob) }
URL.revokeObjectURL = url => { resources.urls--; revokeUrl(url) }
const timeout = globalThis.setTimeout.bind(globalThis)
globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => timeout(callback, resources.mode.endsWith('timeout') && (delay === 30000 || delay === 15000) ? 50 : delay, ...args)) as typeof setTimeout
Object.assign(globalThis, { createPdfSession, mountPdfViewer, pdfTestResources: resources, failPdfWorker: () => failWorker() })
