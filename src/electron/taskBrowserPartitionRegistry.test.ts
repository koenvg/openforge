import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { FileTaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry'

const BROWSER_PARTITION_A = `persist:openforge-task-browser-${'a'.repeat(64)}` as const
const BROWSER_PARTITION_B = `persist:openforge-task-browser-${'b'.repeat(64)}` as const

async function registryPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'openforge-browser-partitions-')), 'registry.json')
}

describe('FileTaskBrowserPartitionRegistry', () => {
  it('durably records one partition per plugin and Task across registry instances', async () => {
    const path = await registryPath()
    const first = new FileTaskBrowserPartitionRegistry(path)

    await first.register({ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A })
    await first.register({ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A })
    await first.register({ pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B })

    const restarted = new FileTaskBrowserPartitionRegistry(path)
    await expect(restarted.listByPlugin('browser')).resolves.toEqual([
      { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A },
      { pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B },
    ])
    await expect(restarted.listByTask('T-1')).resolves.toEqual([
      { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A },
    ])
  })

  it('removes only the acknowledged plugin and Task registration durably', async () => {
    const path = await registryPath()
    const registry = new FileTaskBrowserPartitionRegistry(path)
    await registry.register({ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A })
    await registry.register({ pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B })

    await registry.remove('browser', 'T-1')

    const restarted = new FileTaskBrowserPartitionRegistry(path)
    await expect(restarted.listByPlugin('browser')).resolves.toEqual([
      { pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B },
    ])
  })

  it('keeps a failed registration uncommitted so a later retry still persists it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openforge-browser-partitions-failure-'))
    const path = join(directory, 'registry.json')
    const seed = new FileTaskBrowserPartitionRegistry(path)
    await seed.register({ pluginId: 'seed', taskId: 'T-seed', partition: BROWSER_PARTITION_B })
    await seed.remove('seed', 'T-seed')
    const registry = new FileTaskBrowserPartitionRegistry(path)
    await registry.listByPlugin('browser')
    const record = { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }

    await chmod(directory, 0o500)
    await expect(registry.register(record)).rejects.toThrow(/partition registry/i)
    await chmod(directory, 0o700)
    await registry.register(record)

    await expect(new FileTaskBrowserPartitionRegistry(path).listByPlugin('browser')).resolves.toEqual([record])
  })

  it('refuses to overwrite a corrupt durable registry that would lose purge discovery', async () => {
    const path = await registryPath()
    await writeFile(path, '{not valid json', 'utf8')
    const registry = new FileTaskBrowserPartitionRegistry(path)

    await expect(registry.register({
      pluginId: 'browser',
      taskId: 'T-1',
      partition: BROWSER_PARTITION_A,
    })).rejects.toThrow(/partition registry/i)
    await expect(readFile(path, 'utf8')).resolves.toBe('{not valid json')
  })
})
