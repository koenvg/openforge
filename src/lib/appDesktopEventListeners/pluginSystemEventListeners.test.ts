import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '../ipc'
import { publishPluginGlobalEvent } from '../plugin/runtimeCommonApi'
import { createPluginSystemEventListeners } from './pluginSystemEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

vi.mock('../ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc')>()
  return {
    ...actual,
    writeClipboardText: vi.fn(async () => undefined),
  }
})

vi.mock('../plugin/runtimeCommonApi', () => ({
  publishPluginGlobalEvent: vi.fn(),
}))

describe('createPluginSystemEventListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes backend Trusted Plugin clipboard requests through the host IPC adapter', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPluginSystemEventListeners(), deps.listen!)

    await handlers.get('openforge.write-clipboard-text')?.({ payload: { text: 'Reviewer brief' } })

    expect(writeClipboardText).toHaveBeenCalledWith('Reviewer brief')
  })

  it('forwards backend global Plugin Events to frontend runtime subscribers', async () => {
    const { deps, handlers } = createAppDesktopEventHarness()
    await registerEventListenerGroup(createPluginSystemEventListeners(), deps.listen!)
    const payload = { prId: 42 }

    await handlers.get('plugin-global-event')?.({
      payload: {
        event: 'com.openforge.github-sync.walkthrough-changed',
        payload,
        sourcePluginId: 'com.openforge.github-sync',
      },
    })

    expect(publishPluginGlobalEvent).toHaveBeenCalledWith(
      'com.openforge.github-sync.walkthrough-changed',
      payload,
    )
  })
})
