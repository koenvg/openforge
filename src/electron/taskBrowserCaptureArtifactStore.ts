import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  store(request: StoreTaskBrowserCaptureRequest): Promise<{ artifactId: string }>
  discard(request: DiscardTaskBrowserCaptureRequest): Promise<void>
  cleanupTask(taskId: string): Promise<void>
}

const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ownershipKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class FileTaskBrowserCaptureArtifactStore implements TaskBrowserCaptureArtifactStore {
  constructor(private readonly rootDirectory: () => string) {}

  async store(request: StoreTaskBrowserCaptureRequest): Promise<{ artifactId: string }> {
    const artifactId = randomUUID()
    const directory = this.ownerDirectory(request.taskId, request.pluginId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, `${artifactId}.png`), request.png, { flag: 'wx', mode: 0o600 })
    return { artifactId }
  }

  async discard(request: DiscardTaskBrowserCaptureRequest): Promise<void> {
    if (!ARTIFACT_ID.test(request.artifactId)) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser capture requires a safe artifact identity')
    }

    try {
      await unlink(join(this.ownerDirectory(request.taskId, request.pluginId), `${request.artifactId}.png`))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async cleanupTask(taskId: string): Promise<void> {
    await rm(join(this.rootDirectory(), ownershipKey(taskId)), { recursive: true, force: true })
  }

  private ownerDirectory(taskId: string, pluginId: string): string {
    return join(this.rootDirectory(), ownershipKey(taskId), ownershipKey(pluginId))
  }
}
