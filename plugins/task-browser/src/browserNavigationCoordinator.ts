import {
  isAllowedBrowserSurfaceUrl,
  type Disposable,
  type FrontendOpenForgeAPI,
  type TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'

export interface BrowserNavigationToken {
  readonly taskId: string
  readonly generation: number
}

interface TaskNavigationState {
  generation: number
  observer: Disposable | null
  persistence: Promise<void>
}

const coordinators = new WeakMap<FrontendOpenForgeAPI, BrowserNavigationCoordinator>()

function disposeQuietly(disposable: Disposable | null): void {
  if (disposable !== null) void Promise.resolve(disposable.dispose()).catch(() => undefined)
}

export class BrowserNavigationCoordinator {
  private readonly tasks = new Map<string, TaskNavigationState>()

  constructor(private readonly api: FrontendOpenForgeAPI) {}

  begin(taskId: string): BrowserNavigationToken {
    const state = this.stateFor(taskId)
    state.generation += 1
    disposeQuietly(state.observer)
    state.observer = null
    return { taskId, generation: state.generation }
  }

  current(taskId: string): BrowserNavigationToken {
    const state = this.stateFor(taskId)
    return { taskId, generation: state.generation }
  }

  isCurrent(token: BrowserNavigationToken): boolean {
    return this.stateFor(token.taskId).generation === token.generation
  }

  setObserver(token: BrowserNavigationToken, observer: Disposable): void {
    const state = this.stateFor(token.taskId)
    if (!this.isCurrent(token)) {
      disposeQuietly(observer)
      return
    }
    disposeQuietly(state.observer)
    state.observer = observer
  }

  clearObserver(token: BrowserNavigationToken, observer: Disposable): void {
    const state = this.stateFor(token.taskId)
    if (state.observer === observer) state.observer = null
  }

  persist(token: BrowserNavigationToken, state: TaskBrowserSurfaceState): Promise<boolean> {
    if (state.loading || state.error !== null || !isAllowedBrowserSurfaceUrl(state.url)) {
      return Promise.resolve(false)
    }

    const taskState = this.stateFor(token.taskId)
    const operation = taskState.persistence.then(async () => {
      if (!this.isCurrent(token)) return false
      const storage = this.api.storage.task(token.taskId)
      const previous = await storage.get<string>('lastBrowserUrl')
      if (!this.isCurrent(token)) return false
      await storage.set('lastBrowserUrl', state.url)
      if (this.isCurrent(token)) return true

      if (previous === null) await storage.delete('lastBrowserUrl')
      else await storage.set('lastBrowserUrl', previous)
      return false
    })
    taskState.persistence = operation.then(() => undefined, () => undefined)
    return operation
  }

  async disposeObservers(): Promise<void> {
    const observers = Array.from(this.tasks.values(), state => state.observer)
    for (const state of this.tasks.values()) {
      state.generation += 1
      state.observer = null
    }
    await Promise.all(observers.map(observer => observer?.dispose()))
  }

  private stateFor(taskId: string): TaskNavigationState {
    let state = this.tasks.get(taskId)
    if (!state) {
      state = { generation: 0, observer: null, persistence: Promise.resolve() }
      this.tasks.set(taskId, state)
    }
    return state
  }
}

export function getBrowserNavigationCoordinator(api: FrontendOpenForgeAPI): BrowserNavigationCoordinator {
  let coordinator = coordinators.get(api)
  if (!coordinator) {
    coordinator = new BrowserNavigationCoordinator(api)
    coordinators.set(api, coordinator)
  }
  return coordinator
}
