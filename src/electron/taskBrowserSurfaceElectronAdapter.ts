import { join } from 'node:path'
import { BrowserWindow, WebContentsView, app, session as electronSession } from 'electron'
import type { DownloadItem, Event as ElectronEvent, Session, WebContents } from 'electron'
import { TaskBrowserSurfaceError, integerTaskBrowserBounds } from './taskBrowserSurfaceManager.js'
import type {
  NativeTaskBrowserSurface,
  NativeTaskBrowserSurfaceFactory,
  TaskBrowserBounds,
  TaskBrowserNativeState,
  TaskBrowserNavigationError,
  TaskBrowserSurfaceCreateOptions,
} from './taskBrowserSurfaceManager.js'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'

/**
 * Zoom factor of the window's own renderer, which is how many device-independent pixels one of the
 * CSS pixels it measures Task Browser Attachment bounds in is worth.
 */
export function electronRendererZoomFactor(windowId: number): number {
  const window = BrowserWindow.fromId(windowId)
  if (!window || window.isDestroyed()) return 1
  const zoomFactor = window.webContents.getZoomFactor()
  return Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
}

function allowedTopLevelUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isAbortedNavigationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? error.code : undefined
  return code === -3 || code === 'ERR_ABORTED'
}

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

const DENY_TASK_BROWSER_PERMISSIONS: TaskBrowserPermissionSessionHandler = {
  check: () => false,
  request: async () => false,
}

type PermissionOwner = {
  windowId: number
  handler: TaskBrowserPermissionSessionHandler
}

class ElectronTaskBrowserPermissionRouter {
  private readonly owners = new Map<WebContents, PermissionOwner>()

  constructor(browserSession: Session) {
    browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!webContents) return false
      const owner = this.owners.get(webContents)
      if (!owner) return false
      try {
        return owner.handler.check({ permission, requestingOrigin, details })
      } catch {
        return false
      }
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const owner = this.owners.get(webContents)
      if (!owner) {
        callback(false)
        return
      }
      try {
        void owner.handler.request({ windowId: owner.windowId, permission, details })
          .then(decision => callback(decision === true), () => callback(false))
      } catch {
        callback(false)
      }
    })
  }

  register(webContents: WebContents, owner: PermissionOwner): void {
    this.owners.set(webContents, owner)
  }

  unregister(webContents: WebContents): void {
    this.owners.delete(webContents)
  }
}

const taskBrowserPermissionRouters = new WeakMap<Session, ElectronTaskBrowserPermissionRouter>()

function permissionRouterFor(browserSession: Session): ElectronTaskBrowserPermissionRouter {
  let router = taskBrowserPermissionRouters.get(browserSession)
  if (!router) {
    router = new ElectronTaskBrowserPermissionRouter(browserSession)
    taskBrowserPermissionRouters.set(browserSession, router)
  }
  return router
}

class ElectronNativeTaskBrowserSurface implements NativeTaskBrowserSurface {
  private readonly view: WebContentsView
  private readonly browserSession: Session
  private readonly permissionRouter: ElectronTaskBrowserPermissionRouter
  private readonly listeners = new Set<(state: TaskBrowserNativeState) => void>()
  private readonly childWindows = new Set<BrowserWindow>()
  private readonly activeDownloads = new Map<DownloadItem, () => void>()
  private readonly feedbackAnnotationsByUrl = new Map<string, Array<{
    number: number
    comment: string
    x: number
    y: number
    width: number
    height: number
  }>>()
  private attachedWindow: BrowserWindow | null = null
  private navigationError: TaskBrowserNavigationError | null = null
  private cancelSelection: (() => void) | null = null
  private destroyed = false

  constructor(private readonly options: TaskBrowserSurfaceCreateOptions) {
    this.view = new WebContentsView({
      webPreferences: this.secureWebPreferences(),
    })
    this.browserSession = this.view.webContents.session
    this.permissionRouter = permissionRouterFor(this.browserSession)
    this.permissionRouter.register(this.view.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    this.browserSession.on('will-download', this.handleWillDownload)
    this.configureSecurityPolicy(this.view.webContents)
    this.configureStatePublication(this.view.webContents)
    this.view.webContents.setBackgroundThrottling(true)
  }

  getState(): TaskBrowserNativeState {
    if (this.destroyed) {
      return {
        url: 'about:blank',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: this.navigationError ? { ...this.navigationError } : null,
      }
    }
    const contents = this.view.webContents
    return {
      url: contents.getURL() || 'about:blank',
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      error: this.navigationError ? { ...this.navigationError } : null,
    }
  }

  onStateChanged(listener: (state: TaskBrowserNativeState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async loadURL(url: string): Promise<void> {
    this.navigationError = null
    this.hideVisualFeedbackForNavigation()
    try {
      await this.view.webContents.loadURL(url)
    } catch (error) {
      if (!this.navigationError && !isAbortedNavigationError(error)) {
        this.navigationError = {
          code: 'ERR_FAILED',
          message: error instanceof Error ? error.message : String(error),
          url,
        }
      }
    }
    this.publish()
  }

  attach(windowId: number, bounds: TaskBrowserBounds): void {
    const nativeBounds = integerTaskBrowserBounds(bounds)
    if (nativeBounds.width === 0 || nativeBounds.height === 0) {
      this.detach()
      return
    }
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) throw new Error('Owning OpenForge window is unavailable')
    if (this.attachedWindow !== window) {
      this.detach()
      window.contentView.addChildView(this.view)
      this.attachedWindow = window
    }
    this.view.setBounds(nativeBounds)
    this.view.webContents.setBackgroundThrottling(false)
  }

  detach(): void {
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      this.attachedWindow.contentView.removeChildView(this.view)
    }
    this.attachedWindow = null
    if (!this.destroyed) this.view.webContents.setBackgroundThrottling(true)
  }

  destroy(): void {
    if (this.destroyed) return
    this.detach()
    this.destroyed = true
    this.destroyChildWindows()
    this.browserSession.removeListener('will-download', this.handleWillDownload)
    this.permissionRouter.unregister(this.view.webContents)
    this.cancelActiveDownloads()
    this.listeners.clear()
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async goBack(): Promise<void> {
    this.hideVisualFeedbackForNavigation()
    if (this.view.webContents.navigationHistory.canGoBack()) this.view.webContents.navigationHistory.goBack()
  }

  async goForward(): Promise<void> {
    this.hideVisualFeedbackForNavigation()
    if (this.view.webContents.navigationHistory.canGoForward()) this.view.webContents.navigationHistory.goForward()
  }

  async reload(): Promise<void> {
    this.navigationError = null
    this.hideVisualFeedbackForNavigation()
    this.view.webContents.reload()
  }

  stop(): void {
    this.view.webContents.stop()
    this.publish()
  }

  async selectVisibleRegion() {
    await this.cancelVisibleRegionSelection()
    if (this.destroyed) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (this.attachedWindow === null) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before selecting feedback')
    }
    let requestCancel: (() => void) | null = null
    try {
      const pageUrl = this.view.webContents.getURL()
      const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      const nextAnnotationNumber = Array.from(this.feedbackAnnotationsByUrl.values())
        .flat()
        .reduce((maximum, annotation) => Math.max(maximum, annotation.number), 0) + 1
      const cancelled = new Promise<null>(resolve => {
        requestCancel = () => resolve(null)
      })
      this.cancelSelection = requestCancel
      const selection = this.view.webContents.executeJavaScript(`(() => new Promise((resolve) => {
        const savedAnnotations = ${JSON.stringify(savedAnnotations)};
        const overlayId = '__openforge_visual_feedback_selector__';
        const annotationsId = '__openforge_visual_feedback_annotations__';
        document.getElementById(overlayId)?.remove();

        let annotationsRoot = document.getElementById(annotationsId);
        if (!annotationsRoot) {
          annotationsRoot = document.createElement('div');
          annotationsRoot.id = annotationsId;
          annotationsRoot.setAttribute('aria-label', 'Saved visual feedback');
          annotationsRoot.style.cssText = 'position:absolute;inset:0;z-index:2147483646;pointer-events:none;overflow:visible;';
          document.documentElement.append(annotationsRoot);
        }
        const renderAnnotation = (annotationData) => {
          const annotation = document.createElement('div');
          annotation.setAttribute('role', 'note');
          annotation.setAttribute('aria-label', 'Feedback ' + annotationData.number + ': ' + annotationData.comment);
          annotation.style.cssText = 'position:absolute;left:' + annotationData.x + 'px;top:' + annotationData.y + 'px;width:' + annotationData.width + 'px;height:' + annotationData.height + 'px;border:2px solid #60a5fa;background:rgba(59,130,246,.14);box-sizing:border-box;border-radius:4px;pointer-events:none;';
          const badge = document.createElement('span');
          badge.textContent = String(annotationData.number);
          badge.style.cssText = 'position:absolute;left:-9px;top:-9px;display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#2563eb;color:white;font:600 11px system-ui,sans-serif;box-sizing:border-box;pointer-events:none;';
          annotation.append(badge);
          annotationsRoot.append(annotation);
        };
        annotationsRoot.replaceChildren();
        annotationsRoot.dataset.pageUrl = location.href;
        savedAnnotations.forEach(renderAnnotation);
        const nextAnnotationNumber = ${nextAnnotationNumber};

        const root = document.createElement('div');
        root.id = overlayId;
        root.setAttribute('aria-label', 'Select a region for feedback');
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:13px system-ui,sans-serif;color:white;';

        const hint = document.createElement('div');
        hint.textContent = 'Highlight an area to comment · Esc to cancel';
        hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:rgba(20,20,24,.92);color:white;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.3);';

        const hover = document.createElement('div');
        hover.style.cssText = 'position:fixed;display:none;border:2px solid #60a5fa;background:rgba(59,130,246,.12);pointer-events:none;box-sizing:border-box;border-radius:4px;';
        const selection = document.createElement('div');
        selection.style.cssText = 'position:fixed;display:none;border:2px solid #60a5fa;background:rgba(59,130,246,.18);pointer-events:none;box-sizing:border-box;border-radius:4px;';

        const interaction = document.createElement('div');
        interaction.style.cssText = 'position:fixed;inset:0;cursor:crosshair;pointer-events:auto;background:transparent;';
        root.append(hint, hover, selection, interaction);
        document.documentElement.append(root);

        let start = null;
        let pointerId = null;
        let suggestedRect = null;
        const clamp = (value, max) => Math.min(max, Math.max(0, value));
        const setRect = (element, rect) => {
          element.style.display = 'block';
          element.style.left = rect.x + 'px';
          element.style.top = rect.y + 'px';
          element.style.width = rect.width + 'px';
          element.style.height = rect.height + 'px';
        };
        const normalized = (rect) => ({
          x: rect.x / window.innerWidth,
          y: rect.y / window.innerHeight,
          width: rect.width / window.innerWidth,
          height: rect.height / window.innerHeight,
        });
        const suggestedAt = (x, y) => {
          interaction.style.pointerEvents = 'none';
          const candidate = document.elementsFromPoint(x, y).find(element => {
            if (!(element instanceof HTMLElement) || root.contains(element)) return false;
            const rect = element.getBoundingClientRect();
            return rect.width >= 12 && rect.height >= 12 && rect.width <= window.innerWidth && rect.height <= window.innerHeight;
          });
          interaction.style.pointerEvents = 'auto';
          if (!candidate) return null;
          const rect = candidate.getBoundingClientRect();
          return {
            x: clamp(rect.left, window.innerWidth),
            y: clamp(rect.top, window.innerHeight),
            width: Math.min(rect.width, window.innerWidth - clamp(rect.left, window.innerWidth)),
            height: Math.min(rect.height, window.innerHeight - clamp(rect.top, window.innerHeight)),
          };
        };
        const cleanup = () => {
          document.removeEventListener('keydown', onKeyDown, true);
          root.remove();
        };
        const finish = (value) => {
          cleanup();
          resolve(value);
        };
        const cancelDrag = () => {
          start = null;
          pointerId = null;
          selection.style.display = 'none';
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(null);
          }
        };
        const openComposer = (rect) => {
          interaction.style.pointerEvents = 'none';
          hover.style.display = 'none';
          setRect(selection, rect);

          const composer = document.createElement('form');
          composer.setAttribute('aria-label', 'Visual feedback comment');
          const left = Math.min(Math.max(12, rect.x + rect.width + 8), Math.max(12, window.innerWidth - 300));
          const top = Math.min(Math.max(12, rect.y + rect.height + 8), Math.max(12, window.innerHeight - 142));
          composer.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;width:280px;padding:10px;border-radius:10px;background:rgba(20,20,24,.96);box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:auto;box-sizing:border-box;';
          const label = document.createElement('label');
          label.textContent = 'Feedback comment';
          label.style.cssText = 'display:block;margin-bottom:6px;font-weight:600;';
          const textarea = document.createElement('textarea');
          textarea.setAttribute('aria-label', 'Feedback comment');
          textarea.placeholder = 'Describe what should change…';
          textarea.rows = 3;
          textarea.style.cssText = 'display:block;width:100%;resize:none;box-sizing:border-box;border:1px solid rgba(255,255,255,.2);border-radius:7px;padding:8px;background:#111827;color:white;font:13px system-ui,sans-serif;outline:none;';
          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:8px;';
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = 'Cancel';
          cancel.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;background:transparent;color:white;cursor:pointer;';
          const save = document.createElement('button');
          save.type = 'submit';
          save.textContent = 'Save';
          save.disabled = true;
          save.style.cssText = 'border:0;border-radius:6px;padding:6px 10px;background:#2563eb;color:white;cursor:pointer;';
          actions.append(cancel, save);
          composer.append(label, textarea, actions);
          root.append(composer);
          const dismiss = () => {
            composer.remove();
            selection.style.display = 'none';
            interaction.style.pointerEvents = 'auto';
          };
          cancel.addEventListener('click', dismiss);
          textarea.addEventListener('input', () => { save.disabled = textarea.value.trim().length === 0; });
          const saveFeedback = () => {
            const comment = textarea.value.trim();
            if (!comment) return;
            const normalizedRegion = normalized(rect);
            const annotationData = {
              number: nextAnnotationNumber,
              comment,
              x: window.scrollX + rect.x,
              y: window.scrollY + rect.y,
              width: rect.width,
              height: rect.height,
            };
            renderAnnotation(annotationData);
            finish({ region: normalizedRegion, comment, annotation: annotationData });
          };
          textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              dismiss();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              saveFeedback();
            }
          });
          composer.addEventListener('submit', (event) => {
            event.preventDefault();
            saveFeedback();
          });
          textarea.focus();
        };

        document.addEventListener('keydown', onKeyDown, true);
        interaction.addEventListener('pointermove', (event) => {
          if (start && event.pointerId === pointerId) {
            const x = clamp(event.clientX, window.innerWidth);
            const y = clamp(event.clientY, window.innerHeight);
            setRect(selection, {
              x: Math.min(start.x, x),
              y: Math.min(start.y, y),
              width: Math.abs(x - start.x),
              height: Math.abs(y - start.y),
            });
            return;
          }
          suggestedRect = suggestedAt(event.clientX, event.clientY);
          if (suggestedRect) setRect(hover, suggestedRect);
          else hover.style.display = 'none';
        });
        interaction.addEventListener('pointerleave', () => { if (!start) hover.style.display = 'none'; });
        interaction.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || event.pointerType === 'touch') return;
          event.preventDefault();
          start = { x: event.clientX, y: event.clientY };
          pointerId = event.pointerId;
          interaction.setPointerCapture(event.pointerId);
          hover.style.display = 'none';
          setRect(selection, { x: start.x, y: start.y, width: 0, height: 0 });
        });
        interaction.addEventListener('pointerup', (event) => {
          if (!start || event.pointerId !== pointerId) return;
          const endX = clamp(event.clientX, window.innerWidth);
          const endY = clamp(event.clientY, window.innerHeight);
          let rect = {
            x: Math.min(start.x, endX),
            y: Math.min(start.y, endY),
            width: Math.abs(endX - start.x),
            height: Math.abs(endY - start.y),
          };
          if (rect.width < 6 && rect.height < 6) {
            rect = suggestedRect || suggestedAt(endX, endY) || {
              x: clamp(endX - 12, window.innerWidth - 24),
              y: clamp(endY - 12, window.innerHeight - 24),
              width: 24,
              height: 24,
            };
          }
          cancelDrag();
          openComposer(rect);
        });
      }))()`, true)
      const result = await Promise.race([selection, cancelled])
      if (result === null) return null
      const region = typeof result === 'object' && result !== null ? result.region : null
      const comment = typeof result === 'object' && result !== null ? result.comment : null
      const annotation = typeof result === 'object' && result !== null ? result.annotation : null
      if (
        typeof region !== 'object'
        || region === null
        || ![region.x, region.y, region.width, region.height].every(value => typeof value === 'number' && Number.isFinite(value))
        || region.x < 0
        || region.y < 0
        || region.width <= 0
        || region.height <= 0
        || region.x + region.width > 1.001
        || region.y + region.height > 1.001
        || typeof comment !== 'string'
        || comment.trim().length === 0
        || typeof annotation !== 'object'
        || annotation === null
        || ![annotation.number, annotation.x, annotation.y, annotation.width, annotation.height]
          .every(value => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new Error('Live page returned invalid visual feedback')
      }
      const pageAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      pageAnnotations.push({
        number: annotation.number,
        comment: comment.trim(),
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      })
      this.feedbackAnnotationsByUrl.set(pageUrl, pageAnnotations)
      return {
        region: { x: region.x, y: region.y, width: region.width, height: region.height },
        comment: comment.trim(),
        annotationNumber: annotation.number,
      }
    } catch (error) {
      if (error instanceof TaskBrowserSurfaceError) throw error
      throw new TaskBrowserSurfaceError(
        'CAPTURE_FAILED',
        `Could not select a region on the live Task Browser page: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (requestCancel !== null && this.cancelSelection === requestCancel) this.cancelSelection = null
    }
  }

  async cancelVisibleRegionSelection(): Promise<void> {
    const cancel = this.cancelSelection
    cancel?.()
    this.cancelSelection = null
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents.executeJavaScript(`(() => {
      const overlay = document.getElementById('__openforge_visual_feedback_selector__');
      if (overlay) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        overlay.remove();
      }
    })()`, true).catch(() => undefined)
  }

  async clearVisualFeedback(): Promise<void> {
    await this.cancelVisibleRegionSelection()
    this.feedbackAnnotationsByUrl.clear()
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents.executeJavaScript(`(() => {
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  async captureVisibleViewport() {
    if (this.destroyed) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (this.attachedWindow === null) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before it can be captured')
    }

    await this.setVisualFeedbackVisibility('hidden')
    try {
      const image = await this.view.webContents.capturePage()
      const { width, height } = image.getSize()
      const png = image.toPNG()
      if (width <= 0 || height <= 0 || png.byteLength === 0) {
        throw new Error('Electron returned an empty viewport image')
      }
      return { png, width, height }
    } catch (error) {
      if (error instanceof TaskBrowserSurfaceError) throw error
      throw new TaskBrowserSurfaceError(
        'CAPTURE_FAILED',
        `Could not capture the visible Task Browser viewport: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await this.setVisualFeedbackVisibility('')
    }
  }

  private async setVisualFeedbackVisibility(visibility: '' | 'hidden'): Promise<void> {
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    await this.view.webContents.executeJavaScript(`(() => {
      const annotations = document.getElementById('__openforge_visual_feedback_annotations__');
      if (annotations) annotations.style.visibility = ${JSON.stringify(visibility)};
      if (${visibility === 'hidden'}) return new Promise(resolve => requestAnimationFrame(() => resolve()));
    })()`, true).catch(() => undefined)
  }

  private hideVisualFeedbackForNavigation(): void {
    this.cancelSelection?.()
    this.cancelSelection = null
    if (this.destroyed || this.view.webContents.isDestroyed()) return
    void this.view.webContents.executeJavaScript(`(() => {
      document.getElementById('__openforge_visual_feedback_selector__')?.remove();
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  private refreshVisualFeedbackForCurrentUrl(): void {
    const contents = this.view.webContents
    if (this.destroyed || contents.isDestroyed()) return
    const pageUrl = contents.getURL()
    const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
    void contents.executeJavaScript(`(() => {
      const expectedUrl = ${JSON.stringify(pageUrl)};
      if (location.href !== expectedUrl) return;
      const annotationsId = '__openforge_visual_feedback_annotations__';
      let annotationsRoot = document.getElementById(annotationsId);
      if (!annotationsRoot) {
        annotationsRoot = document.createElement('div');
        annotationsRoot.id = annotationsId;
        annotationsRoot.setAttribute('aria-label', 'Saved visual feedback');
        annotationsRoot.style.cssText = 'position:absolute;inset:0;z-index:2147483646;pointer-events:none;overflow:visible;';
        document.documentElement.append(annotationsRoot);
      }
      const renderAnnotation = (annotationData) => {
        const annotation = document.createElement('div');
        annotation.setAttribute('role', 'note');
        annotation.setAttribute('aria-label', 'Feedback ' + annotationData.number + ': ' + annotationData.comment);
        annotation.style.cssText = 'position:absolute;left:' + annotationData.x + 'px;top:' + annotationData.y + 'px;width:' + annotationData.width + 'px;height:' + annotationData.height + 'px;border:2px solid #60a5fa;background:rgba(59,130,246,.14);box-sizing:border-box;border-radius:4px;pointer-events:none;';
        const badge = document.createElement('span');
        badge.textContent = String(annotationData.number);
        badge.style.cssText = 'position:absolute;left:-9px;top:-9px;display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#2563eb;color:white;font:600 11px system-ui,sans-serif;box-sizing:border-box;pointer-events:none;';
        annotation.append(badge);
        annotationsRoot.append(annotation);
      };
      annotationsRoot.replaceChildren();
      annotationsRoot.dataset.pageUrl = expectedUrl;
      ${JSON.stringify(savedAnnotations)}.forEach(renderAnnotation);
    })()`, true).catch(() => undefined)
  }

  private ownsWebContents(webContents: WebContents): boolean {
    return webContents === this.view.webContents
      || Array.from(this.childWindows).some(window => !window.isDestroyed() && window.webContents === webContents)
  }

  private readonly handleWillDownload = (_event: ElectronEvent, item: DownloadItem, webContents: WebContents): void => {
    if (!this.ownsWebContents(webContents) || this.destroyed) return

    const window = BrowserWindow.fromId(this.options.windowId)
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

  private cancelActiveDownloads(): void {
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

  private configureSecurityPolicy(contents: WebContents): void {
    contents.on('will-navigate', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.view.webContents) this.hideVisualFeedbackForNavigation()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.view.webContents) this.hideVisualFeedbackForNavigation()
    })
    contents.setWindowOpenHandler(({ url, features }) => {
      if (!this.options.popupPolicy.isAllowed({ url, features })) return { action: 'deny' }
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          ...(this.attachedWindow && !this.attachedWindow.isDestroyed()
            ? { parent: this.attachedWindow }
            : {}),
          autoHideMenuBar: true,
          webPreferences: this.secureWebPreferences(),
        },
      }
    })
    contents.on('did-create-window', window => this.registerChildWindow(window))
  }

  private secureWebPreferences() {
    return {
      ...this.options.webPreferences,
      partition: this.options.partition,
      devTools: !app.isPackaged,
    }
  }

  private registerChildWindow(window: BrowserWindow): void {
    if (this.destroyed || window.webContents.session !== this.view.webContents.session) {
      window.destroy()
      return
    }
    this.childWindows.add(window)
    this.permissionRouter.register(window.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    window.on('closed', () => {
      this.childWindows.delete(window)
      this.permissionRouter.unregister(window.webContents)
    })
    this.configureSecurityPolicy(window.webContents)
  }

  private destroyChildWindows(): void {
    for (const childWindow of Array.from(this.childWindows)) {
      if (!childWindow.isDestroyed()) childWindow.destroy()
    }
    this.childWindows.clear()
  }

  private configureStatePublication(contents: WebContents): void {
    contents.on('did-start-loading', () => {
      this.navigationError = null
      this.hideVisualFeedbackForNavigation()
      this.publish()
    })
    contents.on('did-stop-loading', () => this.publish())
    contents.on('did-navigate', () => {
      this.refreshVisualFeedbackForCurrentUrl()
      this.publish()
    })
    contents.on('did-navigate-in-page', () => {
      this.refreshVisualFeedbackForCurrentUrl()
      this.publish()
    })
    contents.on('page-title-updated', () => this.publish())
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      this.navigationError = {
        code: String(errorCode),
        message: errorDescription,
        url: validatedURL,
      }
      this.publish()
    })
  }

  private publish(): void {
    if (this.destroyed) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

export class ElectronTaskBrowserSurfaceFactory implements NativeTaskBrowserSurfaceFactory {
  createSurface(options: TaskBrowserSurfaceCreateOptions): NativeTaskBrowserSurface {
    return new ElectronNativeTaskBrowserSurface(options)
  }

  async clearSession(partition: string): Promise<void> {
    const browserSession = electronSession.fromPartition(partition)
    await browserSession.clearStorageData()
    await browserSession.clearCache()
  }
}
