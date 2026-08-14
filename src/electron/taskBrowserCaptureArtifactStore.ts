import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { TaskBrowserSurfaceError } from './taskBrowserSurfaceContract.js'

export interface StoreTaskBrowserCaptureRequest {
  pluginId: string
  taskId: string
  png: Uint8Array
}

export interface DiscardTaskBrowserCaptureRequest {
  pluginId: string
  taskId: string
  artifactId: string
}

export interface TaskBrowserCaptureArtifactStore {
  store(request: StoreTaskBrowserCaptureRequest): Promise<{ artifactId: string; absolutePath: string }>
  exists(request: DiscardTaskBrowserCaptureRequest): Promise<boolean>
  discard(request: DiscardTaskBrowserCaptureRequest): Promise<void>
  cleanupTask(taskId: string): Promise<void>
}

const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ownershipKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class FileTaskBrowserCaptureArtifactStore implements TaskBrowserCaptureArtifactStore {
  constructor(private readonly rootDirectory: () => string) {}

  async store(request: StoreTaskBrowserCaptureRequest): Promise<{ artifactId: string; absolutePath: string }> {
    const artifactId = randomUUID()
    const directory = this.ownerDirectory(request.taskId, request.pluginId)
    const absolutePath = resolve(directory, `${artifactId}.png`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(absolutePath, request.png, { flag: 'wx', mode: 0o600 })
    return { artifactId, absolutePath }
  }

  async exists(request: DiscardTaskBrowserCaptureRequest): Promise<boolean> {
    const path = this.artifactPath(request)
    try {
      await access(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async discard(request: DiscardTaskBrowserCaptureRequest): Promise<void> {
    try {
      await unlink(this.artifactPath(request))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async cleanupTask(taskId: string): Promise<void> {
    await rm(join(this.rootDirectory(), ownershipKey(taskId)), { recursive: true, force: true })
  }

  private artifactPath(request: DiscardTaskBrowserCaptureRequest): string {
    if (!ARTIFACT_ID.test(request.artifactId)) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser capture requires a safe artifact identity')
    }
    return join(this.ownerDirectory(request.taskId, request.pluginId), `${request.artifactId}.png`)
  }

  private ownerDirectory(taskId: string, pluginId: string): string {
    return join(this.rootDirectory(), ownershipKey(taskId), ownershipKey(pluginId))
  }
}
