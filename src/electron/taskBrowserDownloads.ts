import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import type { DownloadItem, Event as ElectronEvent, Session, WebContents } from 'electron'

const INVALID_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"|?*]/g
const RESERVED_WINDOWS_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const MAX_SUGGESTED_FILENAME_BYTES = 200
const MAX_SUGGESTED_FILENAME_CODE_UNITS = 200

function takeFilenamePrefix(value: string, maxBytes: number, maxCodeUnits: number): string {
  let result = ''
  let byteLength = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (byteLength + characterBytes > maxBytes || result.length + character.length > maxCodeUnits) break
    result += character
    byteLength += characterBytes
  }
  return result
}

function truncateSuggestedFilename(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_SUGGESTED_FILENAME_BYTES && value.length <= MAX_SUGGESTED_FILENAME_CODE_UNITS) {
    return value
  }

  const extensionStart = value.lastIndexOf('.')
  const candidateExtension = extensionStart > 0 ? value.slice(extensionStart) : ''
  const extension = candidateExtension.length <= 32 && Buffer.byteLength(candidateExtension, 'utf8') <= 64
    ? candidateExtension
    : ''
  const basename = extension ? value.slice(0, extensionStart) : value
  const prefix = takeFilenamePrefix(
    basename,
    MAX_SUGGESTED_FILENAME_BYTES - Buffer.byteLength(extension, 'utf8'),
    MAX_SUGGESTED_FILENAME_CODE_UNITS - extension.length,
  )
  return `${prefix}${extension}`
}

export function sanitizeTaskBrowserDownloadFilename(suggestedFilename: string): string {
  const leaf = suggestedFilename.normalize('NFKC').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  let sanitized = leaf
    .replace(INVALID_FILENAME_CHARACTERS, '_')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!sanitized || sanitized === '.' || sanitized === '..') return 'download'
  if (RESERVED_WINDOWS_FILENAME.test(sanitized)) sanitized = `_${sanitized}`

  sanitized = truncateSuggestedFilename(sanitized).replace(/[. ]+$/g, '')
  return sanitized || 'download'
}

export class TaskBrowserDownloadManager {
  private readonly activeDownloads = new Map<DownloadItem, () => void>()

  constructor(
    private readonly browserSession: Session,
    private readonly windowId: number,
    private readonly ownsWebContents: (webContents: WebContents) => boolean,
  ) {
    this.browserSession.on('will-download', this.handleWillDownload)
  }

  destroy(): void {
    this.browserSession.removeListener('will-download', this.handleWillDownload)
    for (const [item, release] of this.activeDownloads) {
      item.removeListener('done', release)
      try {
        item.cancel()
      } catch {
        // Continue releasing the remaining host-owned downloads.
      }
    }
    this.activeDownloads.clear()
  }

  private readonly handleWillDownload = (_event: ElectronEvent, item: DownloadItem, webContents: WebContents): void => {
    if (!this.ownsWebContents(webContents)) return

    const window = BrowserWindow.fromId(this.windowId)
    if (!window || window.isDestroyed()) {
      item.cancel()
      return
    }

    const release = () => this.activeDownloads.delete(item)
    this.activeDownloads.set(item, release)
    item.once('done', release)
    try {
      item.setSaveDialogOptions({
        title: 'Save download',
        defaultPath: join(app.getPath('downloads'), sanitizeTaskBrowserDownloadFilename(item.getFilename())),
        buttonLabel: 'Save',
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      })
    } catch {
      item.removeListener('done', release)
      release()
      item.cancel()
    }
  }
}
