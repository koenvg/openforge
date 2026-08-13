import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { FileTaskBrowserCaptureArtifactStore } from './taskBrowserCaptureArtifactStore'

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
}

describe('Task Browser capture artifact storage', () => {
  it('stores immutable PNG bytes under an opaque Task- and plugin-owned identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-browser-captures-'))
    const store = new FileTaskBrowserCaptureArtifactStore(() => root)
    const png = Buffer.from('immutable-png')

    const first = await store.store({ pluginId: 'plugin-a', taskId: 'T-1', png })
    const second = await store.store({ pluginId: 'plugin-a', taskId: 'T-1', png })

    expect(first.artifactId).toMatch(/^[0-9a-f-]{36}$/)
    expect(isAbsolute(first.absolutePath)).toBe(true)
    expect(first.absolutePath.startsWith(root)).toBe(true)
    expect(first.absolutePath.endsWith(`${first.artifactId}.png`)).toBe(true)
    expect(await readFile(first.absolutePath)).toEqual(png)
    expect(second.artifactId).not.toBe(first.artifactId)
    const files = await filesBelow(root)
    expect(files).toHaveLength(2)
    await expect(readFile(files[0])).resolves.toEqual(png)
  })

  it('cannot discard an artifact through another plugin, Task, or unsafe identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-browser-captures-'))
    const store = new FileTaskBrowserCaptureArtifactStore(() => root)
    const capture = await store.store({ pluginId: 'plugin-a', taskId: 'T-1', png: Buffer.from('png') })

    await store.discard({ pluginId: 'plugin-b', taskId: 'T-1', artifactId: capture.artifactId })
    await store.discard({ pluginId: 'plugin-a', taskId: 'T-2', artifactId: capture.artifactId })
    expect(await filesBelow(root)).toHaveLength(1)

    await expect(store.discard({
      pluginId: 'plugin-a',
      taskId: 'T-1',
      artifactId: '../../outside',
    })).rejects.toMatchObject({ code: 'INVALID_ID' })

    await store.discard({ pluginId: 'plugin-a', taskId: 'T-1', artifactId: capture.artifactId })
    expect(await filesBelow(root)).toHaveLength(0)
  })

  it('cleans one Task runtime directory without touching another Task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-browser-captures-'))
    const store = new FileTaskBrowserCaptureArtifactStore(() => root)
    await store.store({ pluginId: 'plugin-a', taskId: 'T-1', png: Buffer.from('one') })
    await store.store({ pluginId: 'plugin-a', taskId: 'T-2', png: Buffer.from('two') })

    await store.cleanupTask('T-1')

    const files = await filesBelow(root)
    expect(files).toHaveLength(1)
    await expect(readFile(files[0], 'utf8')).resolves.toBe('two')
  })
})
