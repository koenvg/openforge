import { describe, expect, it, vi } from 'vitest'
import { TestingBackendServicesFake } from './backendServicesFake'
import { createMockBackendOpenForgeApi } from '../testing'
import { TestingFrontendContributionFake } from './frontendContributionFake'
import { TestingRegistryServices } from './support'

const PluginView = (() => undefined) as never

describe('testing capability fakes', () => {
  it('keeps frontend contribution state separate from backend service state', async () => {
    const services = new TestingRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const backend = new TestingBackendServicesFake(services)
    const frontend = new TestingFrontendContributionFake(services, (method, payload) => backend.invokeMethod(method, payload))
    const frontendApi = frontend.createApi()
    const backendApi = backend.createApi()
    const start = vi.fn()

    frontendApi.views.register({
      id: 'pull-requests',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      component: PluginView,
    })
    backendApi.backend.registerMethod('sync', { handler: async () => 'synced' })
    backendApi.background.register({ id: 'poller', scope: 'project', start })

    await backend.startNewBackgroundServices(new Set())

    expect(frontend.getSnapshot().views).toMatchObject([{ qualifiedId: 'github.pull-requests' }])
    expect(backend.getSnapshot()).toMatchObject({
      backendMethods: [{ qualifiedId: 'github.sync' }],
      backgroundServices: [{ qualifiedId: 'github.poller', started: true }],
    })
    await expect(frontendApi.backend.invoke('sync')).resolves.toBe('synced')
    expect(start).toHaveBeenCalledOnce()
  })


  it('serves typed video fixtures through the filesystem fake', async () => {
    const api = createMockBackendOpenForgeApi({
      projectId: 'project-1',
      projectFileContents: {
        'assets/demo.mp4': {
          type: 'video',
          content: 'AAECAw==',
          mimeType: 'video/mp4',
          size: 4,
        },
      },
    })

    await expect(api.fs.readFile({ projectId: 'project-1', path: 'assets/demo.mp4' })).resolves.toEqual({
      type: 'video',
      content: 'AAECAw==',
      mimeType: 'video/mp4',
      size: 4,
    })
  })

  it('serves configurable Task workspace fixtures through the filesystem fake', async () => {
    const api = createMockBackendOpenForgeApi({
      taskWorkspaces: {
        'task-1': {
          directories: {
            assets: [{ name: 'demo.mp4', path: 'assets/demo.mp4', isDir: false, size: 4, modifiedAt: null }],
          },
          files: {
            'assets/demo.mp4': {
              type: 'video',
              content: 'AAECAw==',
              mimeType: 'video/mp4',
              size: 4,
            },
          },
          searches: {
            demo: ['assets/demo.mp4'],
          },
        },
        'task-error': { error: 'workspace unavailable' },
      },
    })

    await expect(api.fs.task.readDir({ taskId: 'task-1', path: 'assets' })).resolves.toHaveLength(1)
    await expect(api.fs.task.readFile({ taskId: 'task-1', path: 'assets/demo.mp4' })).resolves.toEqual({
      type: 'video',
      content: 'AAECAw==',
      mimeType: 'video/mp4',
      size: 4,
    })
    await expect(api.fs.task.searchFiles({ taskId: 'task-1', query: 'demo' })).resolves.toEqual(['assets/demo.mp4'])
    await expect(api.fs.task.readDir({ taskId: 'task-1', path: 'missing' }))
      .rejects.toThrow('Task workspace directory not found: task-1:missing')
    await expect(api.fs.task.readFile({ taskId: 'task-1', path: 'missing.txt' }))
      .rejects.toThrow('Task workspace file not found: task-1:missing.txt')
    await expect(api.fs.task.readFile({ taskId: 'missing-task', path: 'README.md' }))
      .rejects.toThrow('No workspace found for task missing-task')
    await expect(api.fs.task.searchFiles({ taskId: 'task-error', query: 'demo' }))
      .rejects.toThrow('workspace unavailable')
  })
  it('records backend user data and external filesystem calls', async () => {
    const api = createMockBackendOpenForgeApi({
      pluginId: 'skill-usage',
      externalTextFiles: [{
        root: '/Users/test/.pi/agent/sessions',
        path: '2026/session.jsonl',
        content: 'ab🙂cd\n',
      }],
    })

    await api.fs.userData.readDir({ path: 'telemetry' })
    await api.fs.userData.readTextFile({ path: 'telemetry/usage.json' })
    await api.fs.userData.writeTextFile({ path: 'telemetry/usage.json', content: '{"runs":1}' })
    await api.fs.external.readDir({ root: '/Users/test/.pi/agent/sessions', path: '2026' })
    await api.fs.external.readTextFile({ root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' })
    const chunks: string[] = []
    for await (const chunk of api.fs.external.readTextFileChunks({
      root: '/Users/test/.pi/agent/sessions',
      path: '2026/session.jsonl',
      chunkSizeBytes: 4,
    })) {
      chunks.push(chunk)
    }

    expect(api.__testing.calls.fsUserDataReadDirs).toEqual([{ path: 'telemetry' }])
    expect(api.__testing.calls.fsUserDataReads).toEqual([{ path: 'telemetry/usage.json' }])
    expect(api.__testing.calls.fsUserDataWrites).toEqual([{ path: 'telemetry/usage.json', content: '{"runs":1}' }])
    expect(api.__testing.calls.fsExternalReadDirs).toEqual([{ root: '/Users/test/.pi/agent/sessions', path: '2026' }])
    expect(api.__testing.calls.fsExternalReads).toEqual([{ root: '/Users/test/.pi/agent/sessions', path: '2026/session.jsonl' }])
    expect(chunks).toEqual(['ab', '🙂', 'cd\n'])
    expect(api.__testing.calls.fsExternalReadTextFileChunks).toEqual([{
      root: '/Users/test/.pi/agent/sessions',
      path: '2026/session.jsonl',
      chunkSizeBytes: 4,
    }])
  })

  it('lists seeded user-data files and nested directories with file metadata', async () => {
    const api = createMockBackendOpenForgeApi({
      userDataTextFiles: [
        { path: 'events/archive/old.json', content: '{}' },
        { path: 'events/state.json', content: 'é' },
        { path: 'root.txt', content: '🙂' },
      ],
    })

    await expect(api.fs.userData.readDir()).resolves.toEqual([
      { name: 'events', path: 'events', isDir: true, size: null, modifiedAt: null },
      { name: 'root.txt', path: 'root.txt', isDir: false, size: 4, modifiedAt: null },
    ])
    await expect(api.fs.userData.readDir({ path: 'events' })).resolves.toEqual([
      { name: 'archive', path: 'events/archive', isDir: true, size: null, modifiedAt: null },
      { name: 'state.json', path: 'events/state.json', isDir: false, size: 2, modifiedAt: null },
    ])
  })

  it('updates user-data directory entries after writes and appends', async () => {
    const api = createMockBackendOpenForgeApi()

    await api.fs.userData.writeTextFile({ path: 'events/current.json', content: 'a' })
    await api.fs.userData.appendTextFile({ path: 'events/current.json', content: '🙂' })
    await api.fs.userData.writeTextFile({ path: 'events/archive/old.json', content: '{}' })

    await expect(api.fs.userData.readDir()).resolves.toEqual([
      { name: 'events', path: 'events', isDir: true, size: null, modifiedAt: null },
    ])
    await expect(api.fs.userData.readDir({ path: 'events' })).resolves.toEqual([
      { name: 'archive', path: 'events/archive', isDir: true, size: null, modifiedAt: null },
      { name: 'current.json', path: 'events/current.json', isDir: false, size: 5, modifiedAt: null },
    ])
  })

  it('stats an external file and reads only the requested identity-bound byte range', async () => {
    const api = createMockBackendOpenForgeApi({
      externalTextFiles: [{
        root: '/sessions',
        path: 'collector.jsonl',
        content: 'old\nab🙂cd\n',
        identity: '41:9',
        modifiedAtMs: 1_767_225_600_000,
      }],
    })

    await expect(api.fs.external.stat({
      root: '/sessions',
      path: 'collector.jsonl',
    })).resolves.toEqual({
      identity: '41:9',
      sizeBytes: 13,
      modifiedAtMs: 1_767_225_600_000,
    })

    const chunks: string[] = []
    for await (const chunk of api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'collector.jsonl',
      expectedIdentity: '41:9',
      startOffsetBytes: 4,
      maxBytes: 6,
      chunkSizeBytes: 4,
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['ab', '🙂'])
    expect(api.__testing.calls.fsExternalStats).toEqual([{
      root: '/sessions',
      path: 'collector.jsonl',
    }])
    expect(api.__testing.calls.fsExternalReadTextFileChunks).toContainEqual({
      root: '/sessions',
      path: 'collector.jsonl',
      expectedIdentity: '41:9',
      startOffsetBytes: 4,
      maxBytes: 6,
      chunkSizeBytes: 4,
    })
  })

  it('models durable user-data append followed by an atomic pointer replacement', async () => {
    const api = createMockBackendOpenForgeApi({
      userDataTextFiles: [{ path: 'events/index.jsonl', content: 'one\n' }],
    })

    await expect(api.fs.userData.appendTextFile({
      path: 'events/index.jsonl',
      content: 'two\n',
    })).resolves.toEqual({ sizeBytes: 8 })
    await api.fs.userData.writeTextFile({
      path: 'events/state.json',
      content: '{"committedBytes":8}\n',
    })

    await expect(api.fs.userData.readTextFile({ path: 'events/index.jsonl' }))
      .resolves.toBe('one\ntwo\n')
    await expect(api.fs.userData.readTextFile({ path: 'events/state.json' }))
      .resolves.toBe('{"committedBytes":8}\n')
    expect(api.__testing.calls.fsUserDataAppends).toEqual([{
      path: 'events/index.jsonl',
      content: 'two\n',
    }])
  })

  it('starts fake ranged I/O lazily and mirrors missing, replacement, and UTF-8 failures', async () => {
    const file = {
      root: '/sessions',
      path: 'collector.jsonl',
      content: 'abcd🙂ef',
      identity: '41:9',
    }
    const api = createMockBackendOpenForgeApi({ externalTextFiles: [file] })
    const stale = api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'collector.jsonl',
      expectedIdentity: 'stale',
      maxBytes: 1,
    })[Symbol.asyncIterator]()

    await expect(stale.next()).rejects.toThrow('External file identity changed')

    const missing = api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'missing.jsonl',
      maxBytes: 1,
    })[Symbol.asyncIterator]()
    await expect(missing.next()).rejects.toThrow('External file not found')

    const replaced = api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'collector.jsonl',
      expectedIdentity: '41:9',
      maxBytes: 8,
      chunkSizeBytes: 4,
    })[Symbol.asyncIterator]()
    await expect(replaced.next()).resolves.toEqual({ value: 'abcd', done: false })
    file.identity = '41:10'
    await expect(replaced.next()).rejects.toThrow('External file identity changed')

    file.identity = '41:9'
    const splitCodePoint = api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'collector.jsonl',
      startOffsetBytes: 5,
      maxBytes: 4,
    })[Symbol.asyncIterator]()
    await expect(splitCodePoint.next()).rejects.toThrow()
  })

  it('stops fake external text iteration after cancellation', async () => {
    const api = createMockBackendOpenForgeApi({
      externalTextFiles: [{ root: '/sessions', path: 'session.jsonl', content: 'abcdef' }],
    })
    const controller = new AbortController()
    const iterator = api.fs.external.readTextFileChunks({
      root: '/sessions',
      path: 'session.jsonl',
      chunkSizeBytes: 4,
      signal: controller.signal,
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({ value: 'abcd', done: false })
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
