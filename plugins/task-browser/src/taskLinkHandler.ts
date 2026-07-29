import {
  isAllowedBrowserSurfaceUrl,
  type FrontendOpenForgeAPI,
  type TaskLinkHandler,
} from '@openforge-app/plugin-sdk/frontend'
import { persistSuccessfulBrowserState } from './browserTabSession'

export function createTaskBrowserLinkHandler(api: FrontendOpenForgeAPI): TaskLinkHandler {
  return async ({ taskId, url }) => {
    if (!isAllowedBrowserSurfaceUrl(url)) return 'declined'

    const surface = await api.browserSurfaces.getOrCreate({ taskId, id: 'main' })
    const state = await surface.navigate(url)
    if (state.error !== null) {
      throw new Error(state.error.message)
    }

    if (!state.loading) {
      const persisted = await persistSuccessfulBrowserState(api, taskId, state)
      if (!persisted) {
        throw new Error(`Task Browser navigation did not settle successfully: ${url}`)
      }
    }

    await api.navigation.navigate({ taskId, taskViewId: 'browser' })
    return 'handled'
  }
}
