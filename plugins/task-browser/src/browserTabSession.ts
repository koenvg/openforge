import {
  BrowserSurfaceError,
  isAllowedBrowserSurfaceUrl,
  type Disposable,
  type FrontendOpenForgeAPI,
  type TaskBrowserSurfaceController,
  type TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'

const LAST_BROWSER_URL_KEY = 'lastBrowserUrl'
const LEGACY_DEFAULT_BROWSER_URL = 'https://example.com/'

export interface BrowserTabSession {
  readonly surface: TaskBrowserSurfaceController
  navigate(address: string): Promise<TaskBrowserSurfaceState>
  stop(): Promise<TaskBrowserSurfaceState>
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

async function savedInitialUrl(api: FrontendOpenForgeAPI, taskId: string): Promise<string | undefined> {
  const storage = api.storage.task(taskId)
  const saved = await storage.get<string>(LAST_BROWSER_URL_KEY)
  if (saved === LEGACY_DEFAULT_BROWSER_URL) {
    await storage.delete(LAST_BROWSER_URL_KEY)
    return undefined
  }
  return saved !== null && isAllowedBrowserSurfaceUrl(saved) ? saved : undefined
}

export async function createBrowserTabSession({
  api,
  taskId,
  element,
  onStateChanged,
}: CreateBrowserTabSessionOptions): Promise<BrowserTabSession> {
  const taskStorage = api.storage.task(taskId)
  const initialUrl = await savedInitialUrl(api, taskId)
  const surface = await api.browserSurfaces.getOrCreate({
    taskId,
    id: 'main',
    ...(initialUrl === undefined ? {} : { initialUrl }),
  })

  let persistence = Promise.resolve()
  let latestState: TaskBrowserSurfaceState | null = null
  let persistenceSuppression: 'none' | 'awaiting-stop-settle' | 'awaiting-next-load' = 'none'
  let subscription: Disposable | null = surface.onStateChanged((state) => {
    latestState = state
    if (persistenceSuppression === 'awaiting-stop-settle' && !state.loading) {
      persistenceSuppression = 'awaiting-next-load'
    } else if (persistenceSuppression === 'awaiting-next-load' && state.loading) {
      persistenceSuppression = 'none'
    }
    onStateChanged(state)
    if (persistenceSuppression === 'none' && !state.loading && isAllowedBrowserSurfaceUrl(state.url) && state.error === null) {
      persistence = persistence
        .then(() => taskStorage.set(LAST_BROWSER_URL_KEY, state.url))
        .catch(() => undefined)
    }
  })
  let attachment: Disposable | null = null

  try {
    attachment = await surface.attach(element)
    latestState = await surface.getState()
    onStateChanged(latestState)
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
    async stop() {
      const shouldSuppressPersistence = latestState?.loading === true
      if (shouldSuppressPersistence) persistenceSuppression = 'awaiting-stop-settle'
      try {
        const state = await surface.stop()
        latestState = state
        return state
      } catch (error) {
        if (shouldSuppressPersistence) persistenceSuppression = 'none'
        throw error
      }
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
