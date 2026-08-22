import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '../ipc'
import { createPluginSystemEventListeners } from './pluginSystemEventListeners'
import { createAppDesktopEventHarness, registerEventListenerGroup } from './testUtils'

vi.mock('../ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ipc')>()
  return {
    ...actual,
    writeClipboardText: vi.fn(async () => undefined),
  }
})

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
})
