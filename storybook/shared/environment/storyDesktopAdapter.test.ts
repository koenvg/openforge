import { afterEach, describe, expect, it } from 'vitest'
import { fsReadDir, fsReadFile, fsSearchFiles, fsWriteFile, getConfig, getProjectConfig, setConfig, setProjectConfig } from '../../../src/lib/ipc'
import type { FileContent } from '../../../src/lib/types'
import { createFileEntry, createStorySettings, createTextFileContent } from '../fixtures/appFixtures'
import { createStoryDesktopAdapter } from './storyDesktopAdapter'

const adapters: Array<{ dispose(): void }> = []

afterEach(() => {
  for (const adapter of adapters.splice(0).reverse()) adapter.dispose()
})

describe('StoryDesktopAdapter', () => {
  it.each([null, undefined, 0])('rejects non-string configuration and file values: %s', async value => {
    const adapter = createStoryDesktopAdapter()
    adapters.push(adapter)
    adapter.install()
    await expect(adapter.bridge.invoke('set_config', { key: 'folder', value })).rejects.toThrow('requires value')
    await expect(adapter.bridge.invoke('set_project_config', { projectId: 'project-1', key: 'folder', value })).rejects.toThrow('requires value')
    await expect(adapter.bridge.invoke('fs_write_file', { projectId: 'project-1', filePath: 'note.txt', content: value })).rejects.toThrow('requires content')
  })

  it('still requires non-empty configuration keys and file paths', async () => {
    const adapter = createStoryDesktopAdapter()
    adapters.push(adapter)
    adapter.install()
    await expect(setConfig('', '')).rejects.toThrow('requires key')
    await expect(fsWriteFile('project-1', '', '')).rejects.toThrow('requires filePath')
  })

  it.each([
    {
      name: 'global configuration',
      write: () => setConfig('folder', ''),
      read: () => getConfig('folder'),
      expected: '',
    },
    {
      name: 'project configuration',
      write: () => setProjectConfig('project-1', 'folder', ''),
      read: () => getProjectConfig('project-1', 'folder'),
      expected: '',
    },
    {
      name: 'file content',
      write: () => fsWriteFile('project-1', 'empty.txt', ''),
      read: () => fsReadFile('project-1', 'empty.txt'),
      expected: { type: 'text', content: '', mimeType: 'text/plain', size: 0 },
    },
  ])('accepts an empty string for $name', async ({ write, read, expected }) => {
    const adapter = createStoryDesktopAdapter({
      config: { folder: 'old' },
      projectConfig: { 'project-1': { folder: 'old' } },
    })
    adapters.push(adapter)
    adapter.install()
    await write()
    await expect(read()).resolves.toEqual(expected)
  })

  it.each<{ name: string; files: Record<string, FileContent>; mimeType: string }>([
    { name: 'new file', files: {}, mimeType: 'text/plain' },
    {
      name: 'existing text file',
      files: { 'project:project-1:note.txt': createTextFileContent({ content: 'old', mimeType: 'text/markdown' }) },
      mimeType: 'text/markdown',
    },
    {
      name: 'existing binary file',
      files: { 'project:project-1:note.txt': { type: 'binary' as const, content: '', mimeType: 'application/octet-stream', size: 99 } },
      mimeType: 'text/plain',
    },
  ])('returns canonical text content after writing a $name', async ({ files, mimeType }) => {
    const adapter = createStoryDesktopAdapter({ files })
    adapters.push(adapter)
    adapter.install()
    await fsWriteFile('project-1', 'note.txt', 'café\n')
    await expect(fsReadFile('project-1', 'note.txt')).resolves.toEqual({
      type: 'text', content: 'café\n', mimeType, size: 6,
    })
  })

  it('holds declared loading responses until release and drains them on disposal', async () => {
    const adapter = createStoryDesktopAdapter({ responses: { get_task_diff: [] }, deferred: ['get_task_diff'] })
    adapters.push(adapter)
    adapter.install()
    let resolved = false
    const first = adapter.bridge.invoke('get_task_diff').then(value => { resolved = true; return value })
    await Promise.resolve()
    expect(resolved).toBe(false)
    adapter.release('get_task_diff')
    await expect(first).resolves.toEqual([])
    adapter.reset()
    const second = adapter.bridge.invoke('get_task_diff')
    adapter.dispose()
    await expect(second).resolves.toEqual([])
  })

  it('installs a desktop bridge, records commands, and restores the previous bridge', async () => {
    const previousBridge = window.openforge
    const adapter = createStoryDesktopAdapter({
      responses: {
        get_projects: [{ id: 'project-1', name: 'OpenForge' }],
      },
    })
    adapters.push(adapter)

    adapter.install()
    await expect(window.openforge?.invoke('get_projects')).resolves.toEqual([
      { id: 'project-1', name: 'OpenForge' },
    ])
    expect(adapter.calls).toEqual([
      { command: 'get_projects', payload: null },
    ])

    adapter.dispose()
    expect(window.openforge).toBe(previousBridge)
  })

  it('delivers desktop events until the subscriber unlistens', () => {
    const adapter = createStoryDesktopAdapter()
    adapters.push(adapter)
    adapter.install()
    const received: unknown[] = []
    const unlisten = window.openforge!.onEvent('task-updated', payload => received.push(payload))

    adapter.emit('task-updated', { taskId: 'T-1' })
    unlisten()
    adapter.emit('task-updated', { taskId: 'T-2' })

    expect(received).toEqual([{ taskId: 'T-1' }])
  })

  it('supports resettable global and project configuration', async () => {
    const adapter = createStoryDesktopAdapter(createStorySettings({ projectProvider: 'pi' }))
    adapters.push(adapter)
    adapter.install()

    await expect(adapter.bridge.invoke('get_config', { key: 'theme' })).resolves.toBe('openforge-dark')
    await adapter.bridge.invoke('set_config', { key: 'theme', value: 'openforge-light' })
    await expect(adapter.bridge.invoke('get_project_config', { projectId: 'project-1', key: 'provider' })).resolves.toBe('pi')
    await adapter.bridge.invoke('set_project_config', { projectId: 'project-1', key: 'provider', value: 'codex' })

    adapter.reset()

    expect(adapter.calls).toEqual([])
    await expect(adapter.bridge.invoke('get_config', { key: 'theme' })).resolves.toBe('openforge-dark')
    await expect(adapter.bridge.invoke('get_project_config', { projectId: 'project-1', key: 'provider' })).resolves.toBe('pi')
  })

  it('returns fixture files and rejects declared failures without live filesystem access', async () => {
    const adapter = createStoryDesktopAdapter({
      files: {
        'project:project-1:README.md': createTextFileContent({ content: '# OpenForge' }),
      },
      directories: {
        'project:project-1:.': [createFileEntry({ size: 11, modifiedAt: null })],
      },
      failures: {
        fs_search_files: 'Search index unavailable',
      },
    })
    adapters.push(adapter)
    adapter.install()

    await expect(fsReadFile('project-1', 'README.md')).resolves.toEqual({
      type: 'text', content: '# OpenForge', mimeType: 'text/plain', size: 11,
    })
    await expect(fsReadDir('project-1', null)).resolves.toEqual([
      { name: 'README.md', path: 'README.md', isDir: false, size: 11, modifiedAt: null },
    ])
    await expect(fsSearchFiles('project-1', 'readme')).rejects.toThrow('Search index unavailable')
  })

  it('fails on undeclared desktop commands', async () => {
    const adapter = createStoryDesktopAdapter()
    adapters.push(adapter)
    adapter.install()

    await expect(adapter.bridge.invoke('unknown_command')).rejects.toThrow(
      'No story response declared for desktop command: unknown_command',
    )
  })
})
