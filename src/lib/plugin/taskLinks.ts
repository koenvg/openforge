import type { Disposable, TaskLinkHandler, TaskLinkOpenRequest } from '@openforge-app/plugin-sdk'

interface RegisteredTaskLinkHandler {
  pluginId: string
  handler: TaskLinkHandler
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export class TaskLinkRouter {
  private registration: RegisteredTaskLinkHandler | null = null

  constructor(private readonly openExternal: (url: string) => Promise<void>) {}

  async open(request: TaskLinkOpenRequest): Promise<void> {
    if (!isHttpUrl(request.url)) {
      throw new Error('Task links must use a valid HTTP(S) URL')
    }

    const registration = this.registration
    if (registration === null) {
      await this.openExternal(request.url)
      return
    }

    const result = await registration.handler(request)
    if (result === 'declined') {
      await this.openExternal(request.url)
      return
    }
    if (result !== 'handled') {
      throw new Error(`Task link handler returned an invalid result: ${String(result)}`)
    }
  }

  registerHandler(pluginId: string, handler: TaskLinkHandler): Disposable {
    if (this.registration !== null) {
      throw new Error(`A Task link handler is already registered by ${this.registration.pluginId}`)
    }

    const registration = { pluginId, handler }
    this.registration = registration
    return {
      dispose: () => {
        if (this.registration === registration) {
          this.registration = null
        }
      },
    }
  }
}

export const taskLinkRouter = new TaskLinkRouter(async (url) => {
  const { openUrl } = await import('../ipc')
  await openUrl(url)
})
