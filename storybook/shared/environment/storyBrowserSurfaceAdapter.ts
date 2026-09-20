import type {
  BrowserSurfaceFeedbackSelection,
  BrowserSurfacesAPI,
  Disposable,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'

export interface StoryBrowserSurfacePage {
  eyebrow?: string
  heading: string
  body: string
}

export interface StoryBrowserSurfaceDefinition {
  initialUrl?: string | null
  title?: string
  state?: Partial<TaskBrowserSurfaceState>
  page?: StoryBrowserSurfacePage
  connectionFailures?: number
  connectionError?: string
  selectionComments?: readonly string[]
}

export interface StoryBrowserSurfaceAdapter {
  readonly api: BrowserSurfacesAPI
  dispose(): Promise<void>
}

type SetSurfaceState = (
  taskId: string,
  id: string,
  patch: Partial<TaskBrowserSurfaceState>,
) => void

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  if (text !== undefined) result.textContent = text
  return result
}

function surfaceContent(
  root: HTMLElement,
  state: TaskBrowserSurfaceState,
  page: StoryBrowserSurfacePage | undefined,
): void {
  root.replaceChildren()

  const chrome = element('div', 'flex min-h-10 items-center gap-2 border-b border-of-border bg-of-panel px-4')
  const lights = element('div', 'flex gap-1.5', '')
  for (const color of ['bg-error/70', 'bg-warning/70', 'bg-success/70']) {
    lights.append(element('span', `h-2.5 w-2.5 rounded-full ${color}`))
  }
  chrome.append(lights)
  const location = element('p', 'min-w-0 flex-1 truncate font-mono text-[11px] text-of-text-muted', state.url)
  location.title = state.url
  chrome.append(location)
  root.append(chrome)

  const content = element('div', 'flex min-h-0 flex-1 items-center justify-center overflow-auto p-8')
  const card = element('article', 'w-full max-w-2xl border border-of-border bg-of-surface p-8 shadow-sm')

  if (state.loading) {
    card.setAttribute('role', 'status')
    card.append(element('p', 'text-xs font-semibold uppercase tracking-[0.16em] text-of-accent', 'Browser surface'))
    card.append(element('h2', 'mt-3 text-2xl font-semibold text-of-text', 'Loading preview…'))
    card.append(element('p', 'mt-3 text-sm text-of-text-muted', 'The local adapter is holding this navigation in progress.'))
  } else if (state.error) {
    card.setAttribute('role', 'alert')
    card.append(element('p', 'text-xs font-semibold uppercase tracking-[0.16em] text-error', state.error.code))
    card.append(element('h2', 'mt-3 text-2xl font-semibold text-of-text', state.error.message))
    card.append(element('p', 'mt-3 font-mono text-xs text-of-text-muted', state.error.url))
  } else if (state.url === 'about:blank') {
    card.append(element('p', 'text-xs font-semibold uppercase tracking-[0.16em] text-of-text-muted', 'Task Browser'))
    card.append(element('h2', 'mt-3 text-2xl font-semibold text-of-text', 'No page loaded'))
    card.append(element('p', 'mt-3 text-sm text-of-text-muted', 'Enter an HTTP or HTTPS address in the toolbar to start browsing.'))
  } else {
    card.append(element('p', 'text-xs font-semibold uppercase tracking-[0.16em] text-of-accent', page?.eyebrow ?? 'Local browser fixture'))
    card.append(element('h2', 'mt-3 text-2xl font-semibold text-of-text', page?.heading ?? (state.title || 'Attached browser page')))
    card.append(element('p', 'mt-3 text-sm leading-6 text-of-text-muted', page?.body ?? 'A deterministic local page is attached without opening an external browser surface.'))
    const action = element('button', 'mt-6 min-h-9 rounded-[var(--of-radius-control)] bg-primary px-4 text-sm font-medium text-primary-content', 'Preview action')
    action.type = 'button'
    card.append(action)
  }

  content.append(card)
  root.append(content)
}

export function createStoryBrowserSurfaceAdapter(
  baseApi: BrowserSurfacesAPI,
  setSurfaceState: SetSurfaceState,
  definition: StoryBrowserSurfaceDefinition = {},
): StoryBrowserSurfaceAdapter {
  let connectionFailures = definition.connectionFailures ?? 0
  const selectionComments = [...(definition.selectionComments ?? [])]
  const initialized = new Set<string>()
  const wrapped = new WeakMap<TaskBrowserSurfaceController, TaskBrowserSurfaceController>()
  const attachments = new Set<Disposable>()
  let disposed = false

  function wrapSurface(surface: TaskBrowserSurfaceController): TaskBrowserSurfaceController {
    const existing = wrapped.get(surface)
    if (existing) return existing

    const proxy = new Proxy(surface, {
      get(target, property, receiver) {
        if (property === 'attach') {
          return async (host: HTMLElement): Promise<Disposable> => {
            if (disposed) throw new Error('Story browser-surface adapter has been disposed')
            const attachment = await target.attach(host)
            const root = element('section', 'absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-of-canvas')
            root.dataset.storyBrowserSurface = 'attached'
            root.setAttribute('aria-label', 'Attached browser page')
            host.append(root)

            const render = (state: TaskBrowserSurfaceState) => surfaceContent(root, state, definition.page)
            const subscription = target.onStateChanged(render)
            render(await target.getState())

            let released = false
            const resource: Disposable = {
              async dispose() {
                if (released) return
                released = true
                attachments.delete(resource)
                root.remove()
                await subscription.dispose()
                await attachment.dispose()
              },
            }
            attachments.add(resource)
            return resource
          }
        }
        if (property === 'selectVisibleRegion') {
          return async (): Promise<BrowserSurfaceFeedbackSelection | null> => {
            const comment = selectionComments.shift()
            if (comment === undefined) return null
            const selection = await target.selectVisibleRegion()
            if (selection === null) return null
            return { ...selection, comment }
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as TaskBrowserSurfaceController
    wrapped.set(surface, proxy)
    return proxy
  }

  const api: BrowserSurfacesAPI = {
    async getOrCreate(request) {
      if (disposed) throw new Error('Story browser-surface adapter has been disposed')
      if (connectionFailures > 0) {
        connectionFailures -= 1
        throw new Error(definition.connectionError ?? 'Browser runtime disconnected')
      }

      const initialUrl = request.initialUrl ?? definition.initialUrl ?? undefined
      const surface = await baseApi.getOrCreate({
        ...request,
        ...(initialUrl === undefined ? {} : { initialUrl }),
      })
      const key = `${request.taskId}\u0000${request.id}`
      if (!initialized.has(key)) {
        initialized.add(key)
        const patch: Partial<TaskBrowserSurfaceState> = {
          ...(definition.title === undefined ? {} : { title: definition.title }),
          ...(definition.state ?? {}),
        }
        if (Object.keys(patch).length > 0) setSurfaceState(request.taskId, request.id, patch)
      }
      return wrapSurface(surface)
    },
    resetSession: () => baseApi.resetSession(),
  }

  return {
    api,
    async dispose() {
      if (disposed) return
      disposed = true
      await Promise.allSettled([...attachments].map(attachment => attachment.dispose()))
      attachments.clear()
    },
  }
}
