import { chmod, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

import { FileTaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry'

const BROWSER_PARTITION_A = `persist:openforge-task-browser-${'a'.repeat(64)}` as const
const BROWSER_PARTITION_B = `persist:openforge-task-browser-${'b'.repeat(64)}` as const

async function registryPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'openforge-browser-partitions-')), 'registry.json')
}

function backupPath(path: string): string {
  return `${path}.backup`
}

function registryLogger() {
  return { warn: vi.fn(), error: vi.fn() }
}

describe('FileTaskBrowserPartitionRegistry', () => {
  it('durably records one partition per plugin and Task across registry instances', async () => {
    const path = await registryPath()
    const first = new FileTaskBrowserPartitionRegistry(path)

    await first.register({ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A })
    await first.register({ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A })
    await first.register({ pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B })

    await expect(readFile(backupPath(path), 'utf8')).resolves.toBe(await readFile(path, 'utf8'))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(backupPath(path))).mode & 0o777).toBe(0o600)

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

  it('recovers a malformed primary and permits future registration and purge writes', async () => {
    const path = await registryPath()
    const registry = new FileTaskBrowserPartitionRegistry(path)
    const firstRecord = { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }
    const secondRecord = { pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B }
    await registry.register(firstRecord)
    await writeFile(path, '{not valid json', 'utf8')
    const logger = registryLogger()
    const recovered = new FileTaskBrowserPartitionRegistry(path, { logger })

    await expect(recovered.listByPlugin('browser')).resolves.toEqual([firstRecord])
    await recovered.register(secondRecord)
    await recovered.remove(firstRecord.pluginId, firstRecord.taskId)

    await expect(readFile(path, 'utf8')).resolves.toBe(await readFile(backupPath(path), 'utf8'))
    await expect(new FileTaskBrowserPartitionRegistry(path).listByPlugin('browser')).resolves.toEqual([
      secondRecord,
    ])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/recovered corrupt primary.+backup/i))
    expect(logger.warn.mock.calls.flat().join(' ')).not.toContain(BROWSER_PARTITION_A)
  })

  it('repairs a malformed backup from its valid primary before future recovery is needed', async () => {
    const path = await registryPath()
    const record = { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }
    await new FileTaskBrowserPartitionRegistry(path).register(record)
    await writeFile(backupPath(path), JSON.stringify({
      version: 1,
      partitions: [{ pluginId: 'browser', taskId: 'T-corrupt', partition: 'persist:invalid' }],
    }), 'utf8')
    const logger = registryLogger()

    await expect(new FileTaskBrowserPartitionRegistry(path, { logger }).listByTask('T-1')).resolves.toEqual([record])

    await expect(readFile(backupPath(path), 'utf8')).resolves.toBe(await readFile(path, 'utf8'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/repaired corrupt backup.+primary/i))
  })

  it('restores a missing primary from its valid backup', async () => {
    const path = await registryPath()
    const record = { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }
    await new FileTaskBrowserPartitionRegistry(path).register(record)
    await unlink(path)
    const logger = registryLogger()

    await expect(new FileTaskBrowserPartitionRegistry(path, { logger }).listByTask('T-1')).resolves.toEqual([record])

    await expect(readFile(path, 'utf8')).resolves.toBe(await readFile(backupPath(path), 'utf8'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/restored missing primary.+backup/i))
  })

  it('promotes a newer backup after an interrupted synchronized write', async () => {
    const path = await registryPath()
    const registry = new FileTaskBrowserPartitionRegistry(path)
    const firstRecord = { pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }
    const secondRecord = { pluginId: 'browser', taskId: 'T-2', partition: BROWSER_PARTITION_B }
    await registry.register(firstRecord)
    const stalePrimary = await readFile(path, 'utf8')
    await registry.register(secondRecord)
    await writeFile(path, stalePrimary, 'utf8')
    const logger = registryLogger()

    await expect(new FileTaskBrowserPartitionRegistry(path, { logger }).listByPlugin('browser')).resolves.toEqual([
      firstRecord,
      secondRecord,
    ])

    await expect(readFile(path, 'utf8')).resolves.toBe(await readFile(backupPath(path), 'utf8'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/recovered stale primary.+newer backup/i))
  })

  it('creates a synchronized private backup when loading a legacy primary', async () => {
    const path = await registryPath()
    await writeFile(path, `${JSON.stringify({
      version: 1,
      partitions: [{ pluginId: 'browser', taskId: 'T-1', partition: BROWSER_PARTITION_A }],
    })}\n`, { mode: 0o600 })

    await expect(new FileTaskBrowserPartitionRegistry(path).listByTask('T-1')).resolves.toHaveLength(1)

    await expect(readFile(backupPath(path), 'utf8')).resolves.toBe(await readFile(path, 'utf8'))
    expect((await stat(backupPath(path))).mode & 0o777).toBe(0o600)
  })

  it('fails closed with actionable diagnostics when both primary and backup are malformed', async () => {
    const path = await registryPath()
    await writeFile(path, '{malformed primary', 'utf8')
    const malformedBackup = JSON.stringify({ version: 1, partitions: [{ pluginId: '', taskId: 'T-1', partition: BROWSER_PARTITION_A }] })
    await writeFile(backupPath(path), malformedBackup, 'utf8')
    const registry = new FileTaskBrowserPartitionRegistry(path)

    const error = await registry.register({
      pluginId: 'browser',
      taskId: 'T-1',
      partition: BROWSER_PARTITION_A,
    }).then(() => null, cause => cause as Error)
    expect(error?.message).toMatch(/manually clear all Task Browser session data/i)
    expect(error?.message).toContain(`${path}.initialized`)
    await expect(readFile(path, 'utf8')).resolves.toBe('{malformed primary')
    await expect(readFile(backupPath(path), 'utf8')).resolves.toBe(malformedBackup)

    // This simulates following the advertised repair after clearing Electron's session storage.
    await Promise.all([unlink(path), unlink(backupPath(path)), unlink(`${path}.initialized`)])
    await expect(new FileTaskBrowserPartitionRegistry(path).listByTask('T-1')).resolves.toEqual([])
  })

  it('fails closed when a malformed primary has no backup', async () => {
    const path = await registryPath()
    await writeFile(path, '{malformed primary', 'utf8')

    await expect(new FileTaskBrowserPartitionRegistry(path).listByTask('T-1'))
      .rejects.toThrow(/valid primary or backup/i)
    await expect(readFile(path, 'utf8')).resolves.toBe('{malformed primary')
  })

  it('fails closed when a missing primary has only a malformed backup', async () => {
    const path = await registryPath()
    const malformedBackup = JSON.stringify({ version: 1, partitions: 'not-an-array' })
    await writeFile(backupPath(path), malformedBackup, 'utf8')

    await expect(new FileTaskBrowserPartitionRegistry(path).listByTask('T-1'))
      .rejects.toThrow(/valid primary or backup/i)
    await expect(readFile(backupPath(path), 'utf8')).resolves.toBe(malformedBackup)
  })
})
