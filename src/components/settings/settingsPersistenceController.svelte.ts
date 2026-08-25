import { createTrackedDebouncedSave } from '../../lib/createTrackedDebouncedSave'
import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
import type { GlobalSettingsSavePayload, ProjectSettingsSavePayload } from '../../lib/settingsSaver'

export type SettingsSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface SettingsPersistenceControllerOptions {
  delayMs: number
  saveProject?: (payload: ProjectSettingsSavePayload) => Promise<void>
  saveGlobal?: (payload: GlobalSettingsSavePayload) => Promise<void>
  onProjectSaved?: (
    payload: ProjectSettingsSavePayload,
    newerPendingPayload: ProjectSettingsSavePayload | null,
  ) => void | Promise<void>
  onError?: (message: string) => void
}

export function createSettingsPersistenceController(options: SettingsPersistenceControllerOptions) {
  const saveProject = options.saveProject ?? saveProjectSettings
  const saveGlobal = options.saveGlobal ?? saveGlobalSettings

  let isSaving = $state(false)
  let saved = $state(false)
  let saveStatus = $state<SettingsSaveStatus>('idle')
  let saveError = $state<string | null>(null)
  let pendingProjectSave: ProjectSettingsSavePayload | null = null
  let pendingGlobalSave: GlobalSettingsSavePayload | null = null
  let savedStatusTimer: ReturnType<typeof setTimeout> | null = null

  const trackedSave = createTrackedDebouncedSave({
    delayMs: options.delayMs,
    save: persistPendingChanges,
  })

  function clearSavedStatusTimer(): void {
    if (!savedStatusTimer) return
    clearTimeout(savedStatusTimer)
    savedStatusTimer = null
  }

  function markDirty(): void {
    clearSavedStatusTimer()
    saved = false
    saveError = null
    saveStatus = 'dirty'
    void trackedSave.schedule().catch(() => {})
  }

  function scheduleProject(payload: ProjectSettingsSavePayload): void {
    pendingProjectSave = payload
    markDirty()
  }

  function scheduleGlobal(changes: GlobalSettingsSavePayload): void {
    pendingGlobalSave = { ...pendingGlobalSave, ...changes }
    markDirty()
  }

  async function persistPendingChanges(): Promise<void> {
    const projectPayload = pendingProjectSave
    const globalPayload = pendingGlobalSave
    pendingProjectSave = null
    pendingGlobalSave = null
    if (!projectPayload && !globalPayload) return

    isSaving = true
    saveStatus = 'saving'
    saveError = null
    clearSavedStatusTimer()
    try {
      if (projectPayload) {
        await saveProject(projectPayload)
        await options.onProjectSaved?.(projectPayload, pendingProjectSave)
      }
      if (globalPayload) {
        await saveGlobal(globalPayload)
      }
      saved = true
      saveStatus = 'saved'
      savedStatusTimer = setTimeout(() => {
        saved = false
        if (saveStatus === 'saved') saveStatus = 'idle'
        savedStatusTimer = null
      }, 2000)
    } catch (value) {
      if (globalPayload) {
        pendingGlobalSave = { ...globalPayload, ...(pendingGlobalSave ?? {}) }
      }
      console.error('Failed to save settings:', value)
      saveError = value instanceof Error ? value.message : String(value)
      options.onError?.(saveError)
      saveStatus = 'error'
      throw value
    } finally {
      isSaving = false
    }
  }

  function runImmediately(fallbackProjectPayload?: ProjectSettingsSavePayload | null): Promise<void> {
    if (!pendingProjectSave && !pendingGlobalSave && fallbackProjectPayload) {
      pendingProjectSave = fallbackProjectPayload
    }
    if (!pendingProjectSave && !pendingGlobalSave) return Promise.resolve()
    return trackedSave.runImmediately()
  }

  function destroy(): void {
    clearSavedStatusTimer()
    void trackedSave.flush().catch(() => {})
  }

  return {
    get isSaving() { return isSaving },
    get saved() { return saved },
    get saveStatus() { return saveStatus },
    get saveError() { return saveError },
    scheduleProject,
    scheduleGlobal,
    flush: trackedSave.flush,
    runImmediately,
    destroy,
  }
}

export type SettingsPersistenceController = ReturnType<typeof createSettingsPersistenceController>
