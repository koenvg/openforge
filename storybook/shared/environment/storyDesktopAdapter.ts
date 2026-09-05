import type { OpenForgeDesktopBridge } from '../../../src/lib/desktopIpc'
import type { FileContent, FileEntry } from '../../../src/lib/types'
import { createTextFileContent } from '../fixtures/appFixtures'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export interface StoryDesktopCall {
  command: string
  payload: unknown
}

export type StoryDesktopResponse = unknown | ((payload: unknown) => unknown | Promise<unknown>)

export interface StoryDesktopDefinition {
  responses?: Readonly<Record<string, StoryDesktopResponse>>
  deferred?: readonly string[]
  failures?: Readonly<Record<string, string>>
  config?: Readonly<Record<string, string>>
  projectConfig?: Readonly<Record<string, Readonly<Record<string, string>>>>
  files?: Readonly<Record<string, FileContent>>
  directories?: Readonly<Record<string, readonly FileEntry[]>>
}

export interface StoryDesktopAdapter extends StoryEnvironmentAdapter {
  readonly bridge: OpenForgeDesktopBridge
  readonly calls: StoryDesktopCall[]
  emit(eventName: string, payload: unknown): void
  release(command: string): void
}

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function stringValue(payload: unknown, field: string): string {
  const value = objectPayload(payload)[field]
  if (typeof value !== 'string') throw new Error(`Story desktop command requires ${field}`)
  return value
}

function stringField(payload: unknown, field: string): string {
  const value = stringValue(payload, field)
  if (!value.length) throw new Error(`Story desktop command requires ${field}`)
  return value
}

function optionalPath(payload: unknown, field: string): string {
  const value = objectPayload(payload)[field]
  return typeof value === 'string' && value.length > 0 ? value : '.'
}

function flattenProjectConfig(
  value: StoryDesktopDefinition['projectConfig'],
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [projectId, entries] of Object.entries(value ?? {})) {
    for (const [key, entry] of Object.entries(entries)) {
      result.set(`${projectId}:${key}`, entry)
    }
  }
  return result
}

export function createStoryDesktopAdapter(
  definition: StoryDesktopDefinition = {},
): StoryDesktopAdapter {
  const initialConfig = new Map(Object.entries(definition.config ?? {}))
  const initialProjectConfig = flattenProjectConfig(definition.projectConfig)
  const initialFiles = new Map(Object.entries(definition.files ?? {}).map(([key, value]) => [key, copy(value)]))
  const initialDirectories = new Map(Object.entries(definition.directories ?? {}).map(([key, value]) => [key, copy(value)]))
  const responses = { ...(definition.responses ?? {}) }
  const failures = { ...(definition.failures ?? {}) }
  const calls: StoryDesktopCall[] = []
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let deferred = new Set(definition.deferred ?? [])
  const pending = new Map<string, Set<() => void>>()

  function release(command: string): void {
    deferred.delete(command)
    for (const resolve of pending.get(command) ?? []) resolve()
    pending.delete(command)
  }

  function drainPending(): void {
    for (const command of pending.keys()) release(command)
  }

  let config = new Map(initialConfig)
  let projectConfig = new Map(initialProjectConfig)
  let files = new Map(initialFiles)
  let directories = new Map(initialDirectories)
  let installed = false
  let disposed = false
  let hadPreviousBridge = false
  let previousBridge: OpenForgeDesktopBridge | undefined

  async function invoke(command: string, payload: unknown = null): Promise<unknown> {
    calls.push({ command, payload: copy(payload) })
    if (deferred.has(command) && !disposed) {
      await new Promise<void>(resolve => {
        const waiters = pending.get(command) ?? new Set()
        waiters.add(resolve)
        pending.set(command, waiters)
      })
    }

    const failure = failures[command]
    if (failure !== undefined) throw new Error(failure)

    switch (command) {
      case 'get_config':
        return config.get(stringField(payload, 'key')) ?? null
      case 'set_config':
        config.set(stringField(payload, 'key'), stringValue(payload, 'value'))
        return undefined
      case 'get_project_config':
        return projectConfig.get(`${stringField(payload, 'projectId')}:${stringField(payload, 'key')}`) ?? null
      case 'set_project_config':
        projectConfig.set(
          `${stringField(payload, 'projectId')}:${stringField(payload, 'key')}`,
          stringValue(payload, 'value'),
        )
        return undefined
      case 'clear_project_config':
        projectConfig.delete(`${stringField(payload, 'projectId')}:${stringField(payload, 'key')}`)
        return undefined
      case 'reset_project_settings_to_global': {
        const prefix = `${stringField(payload, 'projectId')}:`
        projectConfig = new Map([...projectConfig].filter(([key]) => !key.startsWith(prefix)))
        return undefined
      }
      case 'fs_read_file':
        return readFixture(files, `project:${stringField(payload, 'projectId')}:${stringField(payload, 'filePath')}`)
      case 'task_fs_read_file':
        return readFixture(files, `task:${stringField(payload, 'taskId')}:${stringField(payload, 'filePath')}`)
      case 'fs_read_dir':
        return readFixture(directories, `project:${stringField(payload, 'projectId')}:${optionalPath(payload, 'dirPath')}`)
      case 'task_fs_read_dir':
        return readFixture(directories, `task:${stringField(payload, 'taskId')}:${optionalPath(payload, 'dirPath')}`)
      case 'fs_write_file': {
        const key = `project:${stringField(payload, 'projectId')}:${stringField(payload, 'filePath')}`
        const current = files.get(key)
        files.set(key, createTextFileContent({
          content: stringValue(payload, 'content'),
          mimeType: current?.type === 'text' ? current.mimeType : 'text/plain',
        }))
        return undefined
      }
    }

    if (Object.hasOwn(responses, command)) {
      const response = responses[command]
      const value = typeof response === 'function' ? await response(copy(payload)) : response
      return copy(value)
    }

    throw new Error(`No story response declared for desktop command: ${command}`)
  }

  function subscribe(eventName: string, handler: (payload: unknown) => void): () => void {
    const eventListeners = listeners.get(eventName) ?? new Set()
    eventListeners.add(handler)
    listeners.set(eventName, eventListeners)
    return () => {
      eventListeners.delete(handler)
      if (eventListeners.size === 0) listeners.delete(eventName)
    }
  }

  const bridge = Object.freeze<OpenForgeDesktopBridge>({
    version: 1,
    invoke,
    onEvent: subscribe,
    onEventReady: async (eventName, handler) => subscribe(eventName, handler),
  })

  function install(): void {
    if (disposed) throw new Error('Disposed story desktop adapter cannot be installed')
    if (installed) return
    hadPreviousBridge = Object.prototype.hasOwnProperty.call(window, 'openforge')
    previousBridge = window.openforge
    window.openforge = bridge
    installed = true
  }

  function reset(): void {
    if (!installed || disposed) throw new Error('Story desktop adapter must be installed before reset')
    drainPending()
    deferred = new Set(definition.deferred ?? [])
    config = new Map(initialConfig)
    projectConfig = new Map(initialProjectConfig)
    files = new Map([...initialFiles].map(([key, value]) => [key, copy(value)]))
    directories = new Map([...initialDirectories].map(([key, value]) => [key, copy(value)]))
    calls.length = 0
    listeners.clear()
  }

  function emit(eventName: string, payload: unknown): void {
    for (const listener of listeners.get(eventName) ?? []) listener(copy(payload))
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    drainPending()
    listeners.clear()
    if (installed && window.openforge === bridge) {
      if (hadPreviousBridge) window.openforge = previousBridge
      else delete window.openforge
    }
    installed = false
  }

  return Object.freeze({ bridge, calls, install, reset, emit, release, dispose })
}

function readFixture<T>(fixtures: Map<string, T>, key: string): T {
  if (!fixtures.has(key)) throw new Error(`No story fixture declared for: ${key}`)
  return copy(fixtures.get(key) as T)
}
