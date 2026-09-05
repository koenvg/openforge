import type {
  OpenForgeContextSnapshot,
  TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import {
  createOpenForgeRegistryFake,
  type MockFrontendOpenForgeAPI,
  type TestingOpenForgeApiCalls,
  type TestingOpenForgeApiOptions,
  type TestingOpenForgeRegistryFake,
} from '@openforge-app/plugin-sdk/testing'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export type StoryPluginDefinition = Omit<TestingOpenForgeApiOptions, 'storage'>

export interface StoryPluginAdapter extends StoryEnvironmentAdapter {
  readonly api: MockFrontendOpenForgeAPI
  readonly context: OpenForgeContextSnapshot
  readonly calls: TestingOpenForgeApiCalls
  setBrowserSurfaceState(
    taskId: string,
    id: string,
    patch: Partial<TaskBrowserSurfaceState>,
  ): void
}

export function createStoryPluginAdapter(
  definition: StoryPluginDefinition = {},
): StoryPluginAdapter {
  let registry: TestingOpenForgeRegistryFake = createOpenForgeRegistryFake(structuredClone(definition))
  let installed = false
  let disposed = false

  function install(): void {
    if (disposed) throw new Error('Disposed story plugin adapter cannot be installed')
    installed = true
  }

  async function reset(): Promise<void> {
    if (!installed || disposed) throw new Error('Story plugin adapter must be installed before reset')
    await registry.disposeAll()
    registry = createOpenForgeRegistryFake(structuredClone(definition))
  }

  function setBrowserSurfaceState(
    taskId: string,
    id: string,
    patch: Partial<TaskBrowserSurfaceState>,
  ): void {
    registry.setBrowserSurfaceState(taskId, id, patch)
  }

  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    if (installed) await registry.disposeAll()
    installed = false
  }

  return Object.freeze({
    get api() {
      return registry.frontendApi
    },
    get context() {
      return registry.frontendApi.context.getSnapshot()
    },
    get calls() {
      return registry.calls
    },
    install,
    reset,
    setBrowserSurfaceState,
    dispose,
  })
}
