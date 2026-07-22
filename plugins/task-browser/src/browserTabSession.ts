import {
  BrowserSurfaceError,
  isAllowedBrowserSurfaceUrl,
  type Disposable,
  type FrontendOpenForgeAPI,
  type TaskBrowserSurfaceController,
  type TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'

export const DEFAULT_BROWSER_URL = 'https://example.com/'
const LAST_BROWSER_URL_KEY = 'lastBrowserUrl'

export interface BrowserTabSession {
  readonly surface: TaskBrowserSurfaceController
  navigate(address: string): Promise<TaskBrowserSurfaceState>
  dispose(): Promise<void>
}

interface CreateBrowserTabSessionOptions {
  api: FrontendOpenForgeAPI
  taskId: string
  element: HTMLElement
  onStateChanged: (state: TaskBrowserSurfaceState) => void
}

export function normalizeBrowserAddress(input: string): string {
  const value = input.trim()
  if (value.length === 0) {
    throw new BrowserSurfaceError('INVALID_URL', 'Enter an HTTP(S) address')
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  if (!isAllowedBrowserSurfaceUrl(candidate)) {
    throw new BrowserSurfaceError('INVALID_URL', 'Only valid HTTP(S) addresses are supported')
  }

  return new URL(candidate).toString()
}

async function savedInitialUrl(api: FrontendOpenForgeAPI, taskId: string): Promise<string> {
  const saved = await api.storage.task(taskId).get<string>(LAST_BROWSER_URL_KEY)
  return saved !== null && isAllowedBrowserSurfaceUrl(saved) ? saved : DEFAULT_BROWSER_URL
}

export async function createBrowserTabSession({
  api,
  taskId,
  element,
  onStateChanged,
}: CreateBrowserTabSessionOptions): Promise<BrowserTabSession> {
  const taskStorage = api.storage.task(taskId)
  const surface = await api.browserSurfaces.getOrCreate({
    taskId,
    id: 'main',
    initialUrl: await savedInitialUrl(api, taskId),
  })

  let persistence = Promise.resolve()
  let subscription: Disposable | null = surface.onStateChanged((state) => {
    onStateChanged(state)
    if (isAllowedBrowserSurfaceUrl(state.url) && state.error === null) {
      persistence = persistence
        .then(() => taskStorage.set(LAST_BROWSER_URL_KEY, state.url))
        .catch(() => undefined)
    }
  })
  let attachment: Disposable | null = null

  try {
    attachment = await surface.attach(element)
    onStateChanged(await surface.getState())
  } catch (error) {
    const resources = [attachment, subscription]
    attachment = null
    subscription = null
    await Promise.all(resources.map(resource => resource?.dispose()))
    throw error
  }

  let disposed = false
  return {
    surface,
    navigate(address) {
      return surface.navigate(normalizeBrowserAddress(address))
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const resources = [attachment, subscription]
      attachment = null
      subscription = null
      await Promise.all([
        ...resources.map(resource => resource?.dispose()),
        persistence,
      ])
    },
  }
}
