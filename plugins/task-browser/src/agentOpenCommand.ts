import {
  BrowserSurfaceError,
  isAllowedBrowserSurfaceUrl,
  type CommandRegistration,
  type Disposable,
  type FrontendOpenForgeAPI,
  type TaskBrowserSurfaceController,
  type TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import {
  getBrowserNavigationCoordinator,
  type BrowserNavigationCoordinator,
  type BrowserNavigationToken,
} from './browserNavigationCoordinator'

interface OpenTaskBrowserInput {
  url: string
}

interface OpenTaskBrowserOutput {
  accepted: true
}

const OBSERVER_LIFETIME_MS = 30_000

function createDisposable(dispose: () => void | Promise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

function disposeQuietly(disposable: Disposable): void {
  void Promise.resolve(disposable.dispose()).catch(() => undefined)
}

function observeSettledNavigation(
  surface: TaskBrowserSurfaceController,
  coordinator: BrowserNavigationCoordinator,
  token: BrowserNavigationToken,
): { arm(state?: TaskBrowserSurfaceState): void; observer: Disposable } {
  let armed = false
  let active = true
  let subscription: Disposable | null = null
  let expiry: ReturnType<typeof setTimeout> | null = null

  const observer = createDisposable(async () => {
    active = false
    if (expiry !== null) clearTimeout(expiry)
    expiry = null
    const activeSubscription = subscription
    subscription = null
    await activeSubscription?.dispose()
    coordinator.clearObserver(token, observer)
  })

  const inspect = (state: TaskBrowserSurfaceState) => {
    if (!armed || !active) return
    if (!coordinator.isCurrent(token) || state.error !== null || (!state.loading && !isAllowedBrowserSurfaceUrl(state.url))) {
      disposeQuietly(observer)
      return
    }
    if (state.loading) return
    void coordinator.persist(token, state)
      .catch(() => false)
      .finally(() => disposeQuietly(observer))
  }

  subscription = surface.onStateChanged(inspect)
  expiry = setTimeout(() => disposeQuietly(observer), OBSERVER_LIFETIME_MS)
  coordinator.setObserver(token, observer)

  return {
    arm(state) {
      armed = true
      if (state !== undefined) inspect(state)
    },
    observer,
  }
}

export function disposeTaskBrowserOpenObservers(api: FrontendOpenForgeAPI): Promise<void> {
  return getBrowserNavigationCoordinator(api).disposeObservers()
}

export function createTaskBrowserOpenCommand(
  api: FrontendOpenForgeAPI,
): CommandRegistration<OpenTaskBrowserInput, OpenTaskBrowserOutput> {
  return {
    id: 'open',
    title: 'Open in Task Browser',
    discoverable: false,
    agent: {
      description: 'Open an exact HTTP(S) URL that you have already started and verified in this Task’s detached Browser surface.',
      examples: [{ url: 'http://localhost:5173/ready' }],
    },
    input: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          pattern: '^[Hh][Tt][Tt][Pp][Ss]?://',
        },
      },
    },
    output: {
      type: 'object',
      required: ['accepted'],
      additionalProperties: false,
      properties: {
        accepted: { const: true },
      },
    },
    async handler(input, invocation) {
      if (invocation.taskId === null || invocation.taskId.trim().length === 0) {
        throw new BrowserSurfaceError('INVALID_TASK', 'Task Browser open requires Task invocation context')
      }
      if (
        !input
        || typeof input !== 'object'
        || Array.isArray(input)
        || Object.keys(input).length !== 1
        || typeof input.url !== 'string'
        || !isAllowedBrowserSurfaceUrl(input.url)
      ) {
        throw new BrowserSurfaceError('INVALID_URL', 'Task Browser open requires a valid HTTP(S) URL')
      }

      const coordinator = getBrowserNavigationCoordinator(api)
      const token = coordinator.begin(invocation.taskId)
      const surface = await api.browserSurfaces.getOrCreate({ taskId: invocation.taskId, id: 'main' })
      const { arm, observer } = observeSettledNavigation(surface, coordinator, token)

      arm()
      let state: TaskBrowserSurfaceState
      try {
        state = await surface.navigate(input.url)
      } catch {
        await observer.dispose()
        throw new Error('Task Browser navigation could not be accepted')
      }
      if (state.error !== null) {
        await observer.dispose()
        throw new Error('Task Browser navigation was rejected')
      }

      arm(state)
      return { accepted: true }
    },
  }
}
