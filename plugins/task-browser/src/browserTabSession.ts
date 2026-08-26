import {
  BrowserSurfaceError,
  type BrowserDevToolsPanel,
  isAllowedBrowserSurfaceUrl,
  type Disposable,
  type FrontendOpenForgeAPI,
  type TaskBrowserSurfaceController,
  type TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import {
  getBrowserNavigationCoordinator,
  type BrowserNavigationToken,
} from './browserNavigationCoordinator'

const LAST_BROWSER_URL_KEY = 'lastBrowserUrl'
const LEGACY_DEFAULT_BROWSER_URL = 'https://example.com/'

export interface BrowserTabSession {
  readonly surface: TaskBrowserSurfaceController
  navigate(address: string): Promise<TaskBrowserSurfaceState>
  goBack(): Promise<TaskBrowserSurfaceState>
  goForward(): Promise<TaskBrowserSurfaceState>
  reload(): Promise<TaskBrowserSurfaceState>
  stop(): Promise<TaskBrowserSurfaceState>
  openDevTools(panel?: BrowserDevToolsPanel): Promise<TaskBrowserSurfaceState>
  closeDevTools(): Promise<TaskBrowserSurfaceState>
  setPresentation(element: HTMLElement | null): Promise<void>
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

export async function persistSuccessfulBrowserState(
  api: FrontendOpenForgeAPI,
  taskId: string,
  state: TaskBrowserSurfaceState,
  token?: BrowserNavigationToken,
): Promise<boolean> {
  const coordinator = getBrowserNavigationCoordinator(api)
  return coordinator.persist(token ?? coordinator.current(taskId), state)
}

export async function createBrowserTabSession({
  api,
  taskId,
  element,
  onStateChanged,
}: CreateBrowserTabSessionOptions): Promise<BrowserTabSession> {
  const navigationCoordinator = getBrowserNavigationCoordinator(api)
  const initialUrl = await savedInitialUrl(api, taskId)
  const surface = await api.browserSurfaces.getOrCreate({
    taskId,
    id: 'main',
    ...(initialUrl === undefined ? {} : { initialUrl }),
  })

  let persistence = Promise.resolve()
  let latestState: TaskBrowserSurfaceState | null = null
  let persistenceSuppression: 'none' | 'awaiting-stop-settle' | 'awaiting-next-load' = 'none'
  function queueStatePersistence(state: TaskBrowserSurfaceState) {
    const token = navigationCoordinator.current(taskId)
    persistence = persistence
      .then(() => persistSuccessfulBrowserState(api, taskId, state, token))
      .then(() => undefined)
      .catch(() => undefined)
  }
  let subscription: Disposable | null = surface.onStateChanged((state) => {
    latestState = state
    if (persistenceSuppression === 'awaiting-stop-settle' && !state.loading) {
      persistenceSuppression = 'awaiting-next-load'
    } else if (persistenceSuppression === 'awaiting-next-load' && state.loading) {
      persistenceSuppression = 'none'
    }
    onStateChanged(state)
    if (persistenceSuppression === 'none' && !state.loading) {
      queueStatePersistence(state)
    }
  })
  let attachment: Disposable | null = null

  try {
    attachment = await surface.attach(element)
    latestState = await surface.getState()
    onStateChanged(latestState)
    if (!latestState.loading) queueStatePersistence(latestState)
  } catch (error) {
    const resources = [attachment, subscription]
    attachment = null
    subscription = null
    await Promise.all(resources.map(resource => resource?.dispose()))
    throw error
  }

  let disposed = false
  let presentation = Promise.resolve()
  function setPresentation(nextElement: HTMLElement | null): Promise<void> {
    const update = presentation.then(async () => {
      if (disposed) throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser tab session has been disposed')
      const previousAttachment = attachment
      attachment = null
      await previousAttachment?.dispose()
      if (nextElement === null || disposed) return
      const nextAttachment = await surface.attach(nextElement)
      if (disposed) {
        await nextAttachment.dispose()
        return
      }
      attachment = nextAttachment
    })
    presentation = update.catch(() => undefined)
    return update
  }

  return {
    surface,
    navigate(address) {
      const url = normalizeBrowserAddress(address)
      navigationCoordinator.begin(taskId)
      return surface.navigate(url)
    },
    goBack() {
      navigationCoordinator.begin(taskId)
      return surface.goBack()
    },
    goForward() {
      navigationCoordinator.begin(taskId)
      return surface.goForward()
    },
    reload() {
      navigationCoordinator.begin(taskId)
      return surface.reload()
    },
    async stop() {
      navigationCoordinator.begin(taskId)
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
    openDevTools(panel) {
      return surface.openDevTools(panel)
    },
    closeDevTools() {
      return surface.closeDevTools()
    },
    setPresentation,
    async dispose() {
      if (disposed) return
      disposed = true
      await presentation.catch(() => undefined)
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
