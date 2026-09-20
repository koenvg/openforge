import type { DocumentPreviewRead } from '@openforge-app/plugin-sdk'
import type { FileBrowserWorkspaceSource } from '../workspaceSource'
import { createPdfSession, type PdfPageResult, type PdfSession } from './renderer'

export type PdfPhase = 'idle' | 'reading' | 'parsing' | 'rendering' | 'ready' | 'error'
export interface PdfState { phase: PdfPhase; message: string; page: PdfPageResult | null }
interface Selection { source: FileBrowserWorkspaceSource | null; path: string; modifiedAt: number | null; reload: number; visible: boolean }
const messages: Record<string, string> = {
  DOCUMENT_PREVIEW_FORBIDDEN: 'This PDF cannot be read from the authorized project folder.',
  DOCUMENT_PREVIEW_BAD_REQUEST: 'The PDF path is invalid.',
  DOCUMENT_PREVIEW_NOT_FOUND: 'This PDF or its project is no longer available.',
  DOCUMENT_PREVIEW_CHANGED: 'The PDF or project changed while reading. Retry to read the current file.',
  DOCUMENT_PREVIEW_BUSY: 'Two document reads are already active. Try again when they finish.',
  DOCUMENT_PREVIEW_TIMEOUT: 'Reading the PDF timed out. A stalled read may still occupy capacity.',
  DOCUMENT_PREVIEW_UNAVAILABLE_HOST: 'PDF previews are unavailable on this host.',
  DOCUMENT_PREVIEW_IO: 'The PDF could not be read.',
  PDF_WORKER: 'The PDF worker could not start or stopped unexpectedly.',
  PDF_TIMEOUT: 'PDF processing timed out.',
  PDF_RESOURCE: 'This PDF exceeds the preview resource limits.',
  PDF_PAGES: 'PDF previews support at most 2,000 pages.',
  PasswordException: 'Password-protected PDFs cannot be previewed. No password is requested.',
  InvalidPDFException: 'This PDF is empty or corrupt.',
}
function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  const key = error instanceof Error && error.name in messages ? error.name : value.split(':')[0]
  return messages[key] ?? 'The PDF could not be parsed or rendered.'
}

export class PdfPreviewController {
  private generation = 0
  private identity: string | null = null
  private session: PdfSession | null = null
  private destroyed = false
  constructor(private container: HTMLDivElement, private publish: (state: PdfState) => void) {}

  transition(selection: Selection): void {
    if (this.destroyed) return
    const identity = selection.visible ? JSON.stringify([selection.source?.identity, selection.path, selection.modifiedAt, selection.reload]) : null
    if (identity === this.identity) return
    this.identity = identity
    const generation = ++this.generation
    this.release()
    if (identity === null) {
      this.publish({ phase: 'idle', message: '', page: null })
      return
    }
    this.publish({ phase: 'reading', message: 'Reading PDF bytes…', page: null })
    void this.load(selection, generation)
  }

  private async load(selection: Selection, generation: number): Promise<void> {
    const current = () => !this.destroyed && generation === this.generation
    try {
      if (!selection.source?.readDocument) throw new Error('DOCUMENT_PREVIEW_UNAVAILABLE_HOST: unavailable')
      let result: DocumentPreviewRead | null = await selection.source.readDocument(selection.path)
      if (!current()) return
      if (result.status === 'unavailable') {
        const message = {
          'too-large': 'PDF previews support files up to 16 MiB.',
          'unsupported-format': 'This document format cannot be previewed.',
          'invalid-document': 'This PDF is empty or corrupt.',
        }[result.reason]
        this.publish({ phase: 'error', message, page: null })
        return
      }
      if (result.size > 16777216 || result.data.length > 22369624) throw new Error('PDF_RESOURCE: bytes')
      const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0))
      if (bytes.byteLength !== result.size) throw new Error('InvalidPDFException: byte count')
      result = null
      this.publish({ phase: 'parsing', message: 'Parsing PDF…', page: null })
      this.session = createPdfSession(this.container, error => {
        if (!current()) return
        this.release()
        this.publish({ phase: 'error', message: errorMessage(error), page: null })
      })
      const page = await this.session.load(bytes, () => {
        if (current()) this.publish({ phase: 'rendering', message: 'Rendering first page…', page: null })
      })
      if (current()) this.publish({ phase: 'ready', message: '', page })
    } catch (error) {
      if (!current()) return
      this.release()
      this.publish({ phase: 'error', message: errorMessage(error), page: null })
    }
  }

  async fit(): Promise<void> {
    const generation = this.generation
    try {
      const page = await this.session?.fit()
      if (page && generation === this.generation && !this.destroyed) this.publish({ phase: 'ready', message: '', page })
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return
      this.release()
      this.publish({ phase: 'error', message: errorMessage(error), page: null })
    }
  }

  private release(): void {
    const session = this.session
    this.session = null
    session?.destroy()
    this.container.replaceChildren()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    ++this.generation
    this.release()
  }
}
