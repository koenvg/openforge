import { fromStore } from 'svelte/store'
import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
import { deleteProject, setProjectConfig } from '../../lib/ipc'
import { loadEnabledForProject } from '../../lib/plugin/pluginRegistry'
import { reloadProjectDashboardProviderId } from '../../lib/plugin/projectDashboardProviders'
import { loadProjectHierarchyOverrides, loadProjectSettings } from '../../lib/settingsConfig'
import type { ProjectSettingsConfig } from '../../lib/settingsConfig'
import { getProjectIdentity, mergeUpdatedProject, resetProjectAndReload, resetProjectSettingAndReload } from '../../lib/settingsProjectSync'
import type { ProjectSettingsSavePayload } from '../../lib/settingsSaver'
import { activeProjectId, error, projects } from '../../lib/stores'
import type { TaskState } from '../../lib/taskState'

interface SettingsProjectControllerOptions {
  getMode(): 'project' | 'global'
  onProjectDeleted(): void
  onProjectSettingsSaved?(): void | Promise<void>
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsProjectController(options: SettingsProjectControllerOptions) {
  const activeProjectIdState = fromStore(activeProjectId)
  const projectsState = fromStore(projects)

  let projectName = $state('')
  let projectPath = $state('')
  let agentInstructions = $state('')
  let runCommand = $state('')
  let focusFilterStates = $state<TaskState[]>([...DEFAULT_FOCUS_STATES])
  let rawOverrides = $state<Record<string, string | null>>({})
  let resettingSetting = $state<string | null>(null)
  let settingsLoading = $state(false)
  let settingsLoadError = $state<string | null>(null)
  let settingsRequestId = 0
  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  const projectId = $derived(activeProjectIdState.current)
  const hasProject = $derived(!!projectId)
  const overrideCount = $derived(
    Object.values(rawOverrides).filter((value) => value != null).length,
  )

  $effect(() => {
    const identity = getProjectIdentity(projectId, projectsState.current)
    projectName = identity.projectName
    projectPath = identity.projectPath
  })

  $effect(() => {
    const pid = projectId
    if (options.getMode() === 'project' && pid) {
      void reloadSettings(pid)
      return
    }

    settingsRequestId++
    settingsLoadError = null
    settingsLoading = false
    agentInstructions = ''
    runCommand = ''
    focusFilterStates = [...DEFAULT_FOCUS_STATES]
    rawOverrides = {}
  })

  function applySettings(settings: ProjectSettingsConfig): void {
    agentInstructions = settings.agentInstructions
    runCommand = settings.runCommand
    focusFilterStates = settings.focusFilterStates
  }

  async function reloadSettings(pid: string): Promise<void> {
    const requestId = ++settingsRequestId
    settingsLoadError = null
    settingsLoading = true
    try {
      const [settings, overrides] = await Promise.all([
        loadProjectSettings(pid),
        loadProjectHierarchyOverrides(pid),
      ])
      if (requestId !== settingsRequestId) return
      applySettings(settings)
      rawOverrides = overrides
    } catch (value) {
      if (requestId !== settingsRequestId) return
      settingsLoadError = getErrorMessage(value)
      error.set(settingsLoadError)
    } finally {
      if (requestId === settingsRequestId) settingsLoading = false
    }
  }

  function captureSavePayload(): ProjectSettingsSavePayload | null {
    if (!projectId) return null
    return {
      projectId,
      projectName,
      projectPath,
      agentInstructions,
      runCommand,
      focusFilterStates,
    }
  }

  function isLatestIdentityPayload(
    payload: ProjectSettingsSavePayload,
    newerPendingPayload: ProjectSettingsSavePayload | null,
  ): boolean {
    if (newerPendingPayload?.projectId === payload.projectId) {
      return newerPendingPayload.projectName === payload.projectName
        && newerPendingPayload.projectPath === payload.projectPath
    }
    if (projectId === payload.projectId) {
      return projectName === payload.projectName && projectPath === payload.projectPath
    }
    return true
  }

  async function handleSaved(
    payload: ProjectSettingsSavePayload,
    newerPendingPayload: ProjectSettingsSavePayload | null,
  ): Promise<void> {
    await options.onProjectSettingsSaved?.()
    if (!isLatestIdentityPayload(payload, newerPendingPayload)) return
    projects.set(mergeUpdatedProject(projectsState.current, {
      id: payload.projectId,
      name: payload.projectName,
      path: payload.projectPath,
    }))
  }

  async function changeSetting(key: string, value: string): Promise<void> {
    if (!projectId) return
    rawOverrides = { ...rawOverrides, [key]: value }
    try {
      await setProjectConfig(projectId, key, value)
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  async function resetToGlobal(): Promise<void> {
    if (!projectId) return
    try {
      await resetProjectAndReload(projectId, async () => {
        await Promise.all([
          reloadSettings(projectId),
          loadEnabledForProject(projectId),
          reloadProjectDashboardProviderId(projectId),
        ])
      })
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  async function resetSetting(key: string): Promise<void> {
    if (!projectId || resettingSetting) return
    resettingSetting = key
    try {
      await resetProjectSettingAndReload(projectId, key, () => reloadSettings(projectId))
    } catch (value) {
      error.set(getErrorMessage(value))
    } finally {
      resettingSetting = null
    }
  }

  async function deleteCurrentProject(): Promise<void> {
    if (!projectId) return
    isDeleting = true
    deleteError = null
    try {
      await deleteProject(projectId)
      options.onProjectDeleted()
    } catch (value) {
      console.error('Failed to delete project:', value)
      deleteError = getErrorMessage(value)
    } finally {
      isDeleting = false
      confirmingDelete = false
    }
  }

  return {
    get projectId() { return projectId },
    get hasProject() { return hasProject },
    get projectName() { return projectName },
    get projectPath() { return projectPath },
    get agentInstructions() { return agentInstructions },
    get runCommand() { return runCommand },
    get focusFilterStates() { return focusFilterStates },
    get rawOverrides() { return rawOverrides },
    get overrideCount() { return overrideCount },
    get resettingSetting() { return resettingSetting },
    get settingsLoading() { return settingsLoading },
    get settingsLoadError() { return settingsLoadError },
    get isDeleting() { return isDeleting },
    get confirmingDelete() { return confirmingDelete },
    get deleteError() { return deleteError },
    setProjectName(value: string) { projectName = value },
    setProjectPath(value: string) { projectPath = value },
    setRunCommand(value: string) { runCommand = value },
    setAgentInstructions(value: string) { agentInstructions = value },
    setFocusFilterStates(value: TaskState[]) { focusFilterStates = value },
    beginDeleteConfirmation() { confirmingDelete = true; deleteError = null },
    cancelDeleteConfirmation() { confirmingDelete = false; deleteError = null },
    captureSavePayload,
    handleSaved,
    changeSetting,
    resetToGlobal,
    resetSetting,
    deleteCurrentProject,
  }
}

export type SettingsProjectController = ReturnType<typeof createSettingsProjectController>
