import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TaskBrowserPermissionPolicy } from './taskBrowserPermissionPolicy'
import { FileTaskBrowserPermissionStore } from './taskBrowserPermissionStore'

async function storePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'openforge-browser-permissions-')), 'permissions.json')
}

describe('FileTaskBrowserPermissionStore', () => {
  it('persists exact permission decisions across app restarts', async () => {
    const path = await storePath()
    const records = [
      {
        pluginId: 'browser',
        taskId: 'T-1',
        origin: 'https://meet.example',
        descriptor: { permission: 'media' as const, mediaTypes: ['audio' as const] },
        decision: 'allow' as const,
      },
      {
        pluginId: 'browser',
        taskId: 'T-2',
        origin: 'https://calendar.example',
        descriptor: { permission: 'notifications' as const },
        decision: 'block' as const,
      },
    ]

    await new FileTaskBrowserPermissionStore(path).replace(records)

    await expect(new FileTaskBrowserPermissionStore(path).load()).resolves.toEqual(records)
  })

  it('restores remembered permission behavior in a new policy instance', async () => {
    const path = await storePath()
    const firstPrompt = async () => ({ decision: 'allow' as const, remember: true })
    const first = new TaskBrowserPermissionPolicy({
      store: new FileTaskBrowserPermissionStore(path),
      prompt: firstPrompt,
    })
    const firstHandler = await first.createSessionHandler('browser', 'T-restart')
    await firstHandler.request({
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/events', isMainFrame: true },
    })

    const restarted = new TaskBrowserPermissionPolicy({
      store: new FileTaskBrowserPermissionStore(path),
      prompt: async () => { throw new Error('remembered decision should not prompt') },
    })
    const restartedHandler = await restarted.createSessionHandler('browser', 'T-restart')

    expect(restartedHandler.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(true)
    await expect(restartedHandler.request({
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/another', isMainFrame: true },
    })).resolves.toBe(true)
  })

  it('rejects malformed persisted descriptors rather than weakening permission scope', async () => {
    const path = await storePath()
    await writeFile(path, JSON.stringify({
      version: 1,
      decisions: [{
        pluginId: 'browser',
        taskId: 'T-1',
        origin: 'https://meet.example',
        descriptor: { permission: 'media', mediaTypes: ['video', 'audio'] },
        decision: 'allow',
      }],
    }), 'utf8')

    await expect(new FileTaskBrowserPermissionStore(path).load()).rejects.toThrow(/invalid decision/i)
  })
})
