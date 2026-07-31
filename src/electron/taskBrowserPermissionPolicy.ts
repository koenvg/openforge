export type TaskBrowserPermissionDecision = 'allow' | 'block'

const SIMPLE_PERMISSION_LABELS = {
  'clipboard-read': 'Clipboard contents',
  'clipboard-sanitized-write': 'Write to clipboard',
  'display-capture': 'Screen capture',
  fullscreen: 'Fullscreen',
  geolocation: 'Location',
  'idle-detection': 'Activity status',
  mediaKeySystem: 'Protected media',
  midi: 'MIDI devices',
  midiSysex: 'MIDI system exclusive messages',
  notifications: 'Notifications',
  pointerLock: 'Pointer lock',
  keyboardLock: 'Keyboard lock',
  'speaker-selection': 'Audio output devices',
  'storage-access': 'Cross-site storage',
  'top-level-storage-access': 'Top-level storage',
  'window-management': 'Window management',
} as const

export type TaskBrowserMediaType = 'audio' | 'video'
export type TaskBrowserSimplePermission = keyof typeof SIMPLE_PERMISSION_LABELS

export type TaskBrowserPermissionDescriptor =
  | { permission: TaskBrowserSimplePermission }
  | { permission: 'media'; mediaTypes: TaskBrowserMediaType[] }

export function isTaskBrowserPermissionDescriptor(value: unknown): value is TaskBrowserPermissionDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const descriptor = value as Record<string, unknown>
  if (typeof descriptor.permission !== 'string') return false
  if (Object.prototype.hasOwnProperty.call(SIMPLE_PERMISSION_LABELS, descriptor.permission)) {
    return Object.keys(descriptor).length === 1
  }
  if (descriptor.permission !== 'media' || !Array.isArray(descriptor.mediaTypes)) return false
  if (Object.keys(descriptor).length !== 2) return false
  const mediaTypes = descriptor.mediaTypes
  return (mediaTypes.length === 1 && (mediaTypes[0] === 'audio' || mediaTypes[0] === 'video'))
    || (mediaTypes.length === 2 && mediaTypes[0] === 'audio' && mediaTypes[1] === 'video')
}

export interface TaskBrowserPermissionPromptRequest {
  windowId: number
  origin: string
  descriptor: TaskBrowserPermissionDescriptor
  permissionLabel: string
}

export interface TaskBrowserPermissionPromptResult {
  decision: TaskBrowserPermissionDecision
  remember: boolean
}

export interface TaskBrowserPermissionDecisionRecord {
  pluginId: string
  origin: string
  descriptor: TaskBrowserPermissionDescriptor
  decision: TaskBrowserPermissionDecision
}

export interface TaskBrowserPermissionStore {
  load(): Promise<TaskBrowserPermissionDecisionRecord[]>
  replace(records: TaskBrowserPermissionDecisionRecord[]): Promise<void>
}

export interface TaskBrowserPermissionCheckRequest {
  permission: string
  requestingOrigin: string
  details: unknown
}

export interface TaskBrowserPermissionRequest {
  windowId: number
  permission: string
  details: unknown
}

export interface TaskBrowserPermissionSessionHandler {
  check(request: TaskBrowserPermissionCheckRequest): boolean
  request(request: TaskBrowserPermissionRequest): Promise<boolean>
}

export interface TaskBrowserPermissionPolicyOptions {
  store: TaskBrowserPermissionStore
  prompt(request: TaskBrowserPermissionPromptRequest): Promise<TaskBrowserPermissionPromptResult>
}

type NormalizedPermission = {
  origin: string
  descriptor: TaskBrowserPermissionDescriptor
  permissionLabel: string
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function detailRecord(details: unknown): Record<string, unknown> | null {
  return typeof details === 'object' && details !== null ? details as Record<string, unknown> : null
}

function requestingOrigin(details: unknown): string | null {
  return normalizeOrigin(detailRecord(details)?.requestingUrl)
}

function mediaOrigin(details: unknown): string | null {
  const record = detailRecord(details)
  if (!record) return null
  return normalizeOrigin(record.securityOrigin ?? record.requestingUrl)
}

function isSimplePermission(permission: string): permission is TaskBrowserSimplePermission {
  return Object.prototype.hasOwnProperty.call(SIMPLE_PERMISSION_LABELS, permission)
}

function simplePermission(permission: TaskBrowserSimplePermission, origin: string | null): NormalizedPermission | null {
  if (!origin) return null
  return {
    origin,
    descriptor: { permission },
    permissionLabel: SIMPLE_PERMISSION_LABELS[permission],
  }
}

function mediaPermission(
  origin: string | null,
  mediaTypes: TaskBrowserMediaType[] | null,
): NormalizedPermission | null {
  if (!origin || !mediaTypes?.length) return null
  const exactTypes = [...new Set(mediaTypes)].sort() as TaskBrowserMediaType[]
  return {
    origin,
    descriptor: { permission: 'media', mediaTypes: exactTypes },
    permissionLabel: exactTypes.length === 2
      ? 'Camera and microphone'
      : exactTypes[0] === 'audio' ? 'Microphone' : 'Camera',
  }
}

function requestMediaTypes(details: unknown): TaskBrowserMediaType[] | null {
  const mediaTypes = detailRecord(details)?.mediaTypes
  if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) return null
  if (!mediaTypes.every(value => value === 'audio' || value === 'video')) return null
  return mediaTypes
}

function normalizePermissionRequest(permission: string, details: unknown): NormalizedPermission | null {
  if (isSimplePermission(permission)) return simplePermission(permission, requestingOrigin(details))
  if (permission === 'media') return mediaPermission(mediaOrigin(details), requestMediaTypes(details))
  return null
}

function normalizePermissionCheck(request: TaskBrowserPermissionCheckRequest): NormalizedPermission | null {
  if (!isSimplePermission(request.permission)) return null
  return simplePermission(request.permission, normalizeOrigin(request.requestingOrigin))
}

function decisionKey(
  pluginId: string,
  permission: Pick<NormalizedPermission, 'origin' | 'descriptor'>,
): string {
  return JSON.stringify([pluginId, permission.origin, permission.descriptor])
}

export class TaskBrowserPermissionPolicy {
  private readonly records = new Map<string, TaskBrowserPermissionDecisionRecord>()
  private readonly sessionEpochs = new Map<string, number>()
  private initialization: Promise<void> | null = null
  private operation: Promise<void> = Promise.resolve()
  constructor(private readonly options: TaskBrowserPermissionPolicyOptions) {}

  /**
   * Decisions are remembered per plugin and origin, never per Task, because every Task shares one
   * Plugin Browser Session. Approving a site in one Task approves it in all of them. See ADR 0012.
   */
  async createSessionHandler(pluginId: string): Promise<TaskBrowserPermissionSessionHandler> {
    await this.initialize()
    return {
      check: request => {
        const normalized = normalizePermissionCheck(request)
        if (!normalized) return false
        return this.records.get(decisionKey(pluginId, normalized))?.decision === 'allow'
      },
      request: async request => {
        const normalized = normalizePermissionRequest(request.permission, request.details)
        if (!normalized) return false
        const key = decisionKey(pluginId, normalized)
        const remembered = this.records.get(key)
        if (remembered) return remembered.decision === 'allow'

        const observedEpoch = this.sessionEpochs.get(pluginId) ?? 0
        const result = await this.options.prompt({
          windowId: request.windowId,
          ...normalized,
        })
        if (result.remember && (this.sessionEpochs.get(pluginId) ?? 0) === observedEpoch) {
          await this.exclusive(async () => {
            if ((this.sessionEpochs.get(pluginId) ?? 0) !== observedEpoch) return
            const record: TaskBrowserPermissionDecisionRecord = {
              pluginId,
              origin: normalized.origin,
              descriptor: normalized.descriptor,
              decision: result.decision,
            }
            const nextRecords = new Map(this.records)
            nextRecords.set(key, record)
            await this.options.store.replace([...nextRecords.values()])
            this.records.set(key, record)
          })
        }
        return result.decision === 'allow'
      },
    }
  }

  async clearSession(pluginId: string): Promise<void> {
    this.bumpSessionEpoch(pluginId)
    await this.initialize()
    await this.removeWhere(record => record.pluginId === pluginId)
  }

  private async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        for (const record of await this.options.store.load()) {
          this.records.set(decisionKey(record.pluginId, record), record)
        }
      })()
    }
    await this.initialization
  }

  private bumpSessionEpoch(pluginId: string): void {
    this.sessionEpochs.set(pluginId, (this.sessionEpochs.get(pluginId) ?? 0) + 1)
  }

  private async removeWhere(predicate: (record: TaskBrowserPermissionDecisionRecord) => boolean): Promise<void> {
    await this.exclusive(async () => {
      const removed: Array<[string, TaskBrowserPermissionDecisionRecord]> = []
      for (const [key, record] of this.records) {
        if (!predicate(record)) continue
        removed.push([key, record])
        this.records.delete(key)
      }
      if (removed.length === 0) return
      try {
        await this.options.store.replace([...this.records.values()])
      } catch (error) {
        for (const [key, record] of removed) this.records.set(key, record)
        throw error
      }
    })
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}
