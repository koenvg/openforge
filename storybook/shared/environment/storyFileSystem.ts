import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { FileContent, FileEntry } from '@openforge-app/plugin-sdk/domain'
import { createTextFileContent } from '../fixtures/appFixtures'

export interface StoryFileSystemDefinition {
  directories: Readonly<Record<string, readonly FileEntry[]>>
  files: Readonly<Record<string, FileContent>>
  /** Operation keys are directory:<path>, file:<path>, or search:<query>. */
  deferred?: readonly string[]
  failures?: Readonly<Record<string, string>>
}

/** A private filesystem per environment. The supplied API must be the SDK fake, never a host API. */
export function createStoryFileSystem(definition: StoryFileSystemDefinition, fallback: FrontendOpenForgeAPI['fs']) {
  const directories = new Map(Object.entries(structuredClone(definition.directories)))
  const files = new Map(Object.entries(structuredClone(definition.files)))
  const deferred = new Set(definition.deferred)
  const failures = new Map(Object.entries(definition.failures ?? {}))
  const pending = new Map<string, Set<{ resolve(): void; reject(error: Error): void }>>()
  let disposed = false

  async function wait(key: string): Promise<void> {
    if (disposed) throw new Error('Story filesystem disposed')
    if (deferred.has(key)) await new Promise<void>((resolve, reject) => {
      const requests = pending.get(key) ?? new Set()
      requests.add({ resolve, reject })
      pending.set(key, requests)
    })
    if (disposed) throw new Error('Story filesystem disposed')
    if (failures.has(key)) throw new Error(failures.get(key))
  }

  const readDir = async ({ path }: { path?: string | null }): Promise<FileEntry[]> => {
    await wait(`directory:${path ?? ''}`)
    const entries = directories.get(path ?? '')
    if (!entries) throw new Error(`Story directory not found: ${path}`)
    return structuredClone([...entries])
  }
  const readFile = async ({ path }: { path: string }): Promise<FileContent> => {
    await wait(`file:${path}`)
    const content = files.get(path)
    if (!content) throw new Error(`Story file not found: ${path}`)
    return structuredClone(content)
  }
  const searchFiles = async ({ query, limit }: { query: string; limit?: number }): Promise<string[]> => {
    await wait(`search:${query}`)
    return [...files.keys()].filter(path => path.toLowerCase().includes(query.toLowerCase())).slice(0, limit)
  }
  const fs: FrontendOpenForgeAPI['fs'] = {
    ...fallback,
    readDir, readFile, searchFiles,
    writeFile: async ({ path, content }) => {
      await wait(`write:${path}`)
      files.set(path, createTextFileContent({ content }))
    },
    task: { ...fallback.task, readDir, readFile, searchFiles },
  }
  return {
    fs,
    release(key: string) {
      deferred.delete(key)
      failures.delete(key)
      for (const request of pending.get(key) ?? []) request.resolve()
      pending.delete(key)
    },
    dispose() {
      disposed = true
      for (const requests of pending.values()) {
        for (const request of requests) request.reject(new Error('Story filesystem disposed'))
      }
      pending.clear()
    },
  }
}
