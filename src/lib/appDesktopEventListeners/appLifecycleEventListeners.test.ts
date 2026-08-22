import { beforeEach, describe, expect, it, vi } from 'vitest'
import { replayPtyBuffersForActiveTerminals } from '../terminalPool'
import { createAppLifecycleEventListeners } from './appLifecycleEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

vi.mock('../terminalPool', () => ({
  replayPtyBuffersForActiveTerminals: vi.fn(async () => undefined),
}))

describe('createAppLifecycleEventListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reloads authoritative state when the app event stream reports a delivery gap', async () => {
    const { deps, handlers, listen } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createAppLifecycleEventListeners(deps), deps.listen!)

    await handlers.get('openforge-app-events-gap')?.({
      payload: { requestedAfter: 'epoch-1:1', oldestAvailable: 'epoch-1:4', newestAvailable: 'epoch-1:8' },
    })

    expect(deps.loadTasks).toHaveBeenCalledOnce()
    expect(deps.loadSessions).toHaveBeenCalledOnce()
    expect(deps.loadPullRequests).toHaveBeenCalledOnce()
    expect(deps.loadProjectAttention).toHaveBeenCalledOnce()
    expect(deps.refreshPrCounts).toHaveBeenCalledOnce()
    expect(replayPtyBuffersForActiveTerminals).toHaveBeenCalledOnce()
    expect(listen).toHaveBeenCalledOnce()
  })
})
