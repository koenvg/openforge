import { loadActions } from './actions'
import { loadFocusFilterStates } from './boardFilters'
import {
  checkClaudeInstalled,
  checkCodexInstalled,
  checkOpenCodeInstalled,
  checkPiInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
} from './ipc'
import { RUN_COMMAND_CONFIG_KEY } from './runAppCommand'
import { HIERARCHICAL_SETTINGS } from './hierarchicalSettings'
import type { TaskState } from './taskState'
import type { Action, ClaudeInstallStatus, WhisperModelStatus } from './types'

/**
 * Unified-settings keys (excluding the plugins control) that a project can
 * override. Used to load the raw project overrides that feed the shared
 * hierarchical settings card's effective-value merge.
 */
export const PROJECT_HIERARCHY_KEYS: string[] = HIERARCHICAL_SETTINGS
  .filter((setting) => setting.control !== 'plugins' && setting.levels.includes('project'))
  .map((setting) => setting.key)

export interface ProjectSettingsConfig {
  agentInstructions: string
  handoffNotesTemplate: string
  aiProvider: string
  projectColor: string
  useWorktrees: boolean
  runCommand: string
  actions: Action[]
  focusFilterStates: TaskState[]
}

export interface GlobalSettingsConfig {
  taskIdPrefix: string
  githubToken: string
  codeCleanupTasksEnabled: boolean
  taskDisplayTitleMetadataUpdatesEnabled: boolean
  githubPollInterval: number
  handoffNotesEnabled: boolean
  useWorktrees: boolean
  aiProvider: string
}

export interface InstallationStatus {
  opencodeInstalled: boolean
  opencodeVersion: string | null
  claudeInstalled: boolean
  claudeVersion: string | null
  claudeAuthenticated: boolean
  piInstalled: boolean
  piVersion: string | null
  codexInstalled: boolean
  codexVersion: string | null
}

export const DEFAULT_GITHUB_POLL_INTERVAL_SECONDS = 60
export const MIN_GITHUB_POLL_INTERVAL_SECONDS = 15
export const MAX_GITHUB_POLL_INTERVAL_SECONDS = 300

export function clampGitHubPollIntervalSeconds(value: number): number {
  return Math.min(
    MAX_GITHUB_POLL_INTERVAL_SECONDS,
    Math.max(MIN_GITHUB_POLL_INTERVAL_SECONDS, value),
  )
}

export function normalizeGitHubPollIntervalSeconds(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_GITHUB_POLL_INTERVAL_SECONDS
  }

  return clampGitHubPollIntervalSeconds(value)
}

export function parseGitHubPollIntervalSeconds(value: string | null | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    return DEFAULT_GITHUB_POLL_INTERVAL_SECONDS
  }

  return normalizeGitHubPollIntervalSeconds(Number(value))
}

interface OpenCodeInstallStatus {
  installed: boolean
  path: string | null
  version: string | null
}

const DEFAULT_PROJECT_SETTINGS: Omit<ProjectSettingsConfig, 'actions' | 'focusFilterStates'> = {
  agentInstructions: '',
  handoffNotesTemplate: '',
  aiProvider: 'claude-code',
  projectColor: '',
  useWorktrees: true,
  runCommand: '',
}

const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsConfig = {
  taskIdPrefix: '',
  githubToken: '',
  codeCleanupTasksEnabled: false,
  taskDisplayTitleMetadataUpdatesEnabled: false,
  githubPollInterval: DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
  handoffNotesEnabled: true,
  useWorktrees: true,
  aiProvider: 'claude-code',
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettingsConfig> {
  const [instructions, handoffTemplate, provider, color, useWorktrees, runCommand, actions, focusFilterStates] = await Promise.all([
    getProjectConfig(projectId, 'additional_instructions'),
    getProjectConfig(projectId, 'handoff_notes_template'),
    getProjectConfig(projectId, 'ai_provider'),
    getProjectConfig(projectId, 'project_color'),
    getProjectConfig(projectId, 'use_worktrees'),
    getProjectConfig(projectId, RUN_COMMAND_CONFIG_KEY),
    loadActions(projectId),
    loadFocusFilterStates(projectId),
  ])

  return {
    agentInstructions: instructions ?? DEFAULT_PROJECT_SETTINGS.agentInstructions,
    handoffNotesTemplate: handoffTemplate ?? DEFAULT_PROJECT_SETTINGS.handoffNotesTemplate,
    aiProvider: provider ?? DEFAULT_PROJECT_SETTINGS.aiProvider,
    projectColor: color ?? DEFAULT_PROJECT_SETTINGS.projectColor,
    useWorktrees: useWorktrees == null ? DEFAULT_PROJECT_SETTINGS.useWorktrees : useWorktrees === 'true',
    runCommand: runCommand ?? DEFAULT_PROJECT_SETTINGS.runCommand,
    actions,
    focusFilterStates,
  }
}

/**
 * Load the raw project overrides for every unified-settings hierarchy key.
 * A `null` value means the project has no override and inherits from global.
 */
export async function loadProjectHierarchyOverrides(
  projectId: string,
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    PROJECT_HIERARCHY_KEYS.map(
      async (key) => [key, await getProjectConfig(projectId, key)] as const,
    ),
  )
  return Object.fromEntries(entries)
}

export async function loadGlobalSettings(): Promise<GlobalSettingsConfig> {
  const [taskIdPrefix, githubToken, codeCleanupTasksEnabled, taskDisplayTitleMetadataUpdatesEnabled, githubPollInterval, handoffNotesEnabled, useWorktrees, aiProvider] = await Promise.all([
    getConfig('task_id_prefix'),
    getConfig('github_token'),
    getConfig('code_cleanup_tasks_enabled'),
    getConfig('task_display_title_metadata_updates_enabled'),
    getConfig('github_poll_interval'),
    getConfig('handoff_notes_enabled'),
    getConfig('use_worktrees'),
    getConfig('ai_provider'),
  ])

  return {
    taskIdPrefix: taskIdPrefix ?? DEFAULT_GLOBAL_SETTINGS.taskIdPrefix,
    githubToken: githubToken ?? DEFAULT_GLOBAL_SETTINGS.githubToken,
    codeCleanupTasksEnabled: codeCleanupTasksEnabled === 'true',
    taskDisplayTitleMetadataUpdatesEnabled: taskDisplayTitleMetadataUpdatesEnabled === 'true',
    githubPollInterval: parseGitHubPollIntervalSeconds(githubPollInterval),
    handoffNotesEnabled: handoffNotesEnabled == null ? DEFAULT_GLOBAL_SETTINGS.handoffNotesEnabled : handoffNotesEnabled === 'true',
    useWorktrees: useWorktrees == null ? DEFAULT_GLOBAL_SETTINGS.useWorktrees : useWorktrees === 'true',
    aiProvider: aiProvider ?? DEFAULT_GLOBAL_SETTINGS.aiProvider,
  }
}

export async function loadInstallationStatus(): Promise<InstallationStatus> {
  const [opencodeResult, claudeResult, piResult, codexResult] = await Promise.all([
    checkOpenCodeInstalled().catch<OpenCodeInstallStatus>(() => ({
      installed: false,
      path: null,
      version: null,
    })),
    checkClaudeInstalled().catch<ClaudeInstallStatus>(() => ({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
    })),
    checkPiInstalled().catch(() => ({
      installed: false,
      path: null,
      version: null,
    })),
    checkCodexInstalled().catch(() => ({
      installed: false,
      path: null,
      version: null,
    })),
  ])

  return {
    opencodeInstalled: opencodeResult.installed,
    opencodeVersion: opencodeResult.version,
    claudeInstalled: claudeResult.installed,
    claudeVersion: claudeResult.version,
    claudeAuthenticated: claudeResult.authenticated,
    piInstalled: piResult.installed,
    piVersion: piResult.version,
    codexInstalled: codexResult.installed,
    codexVersion: codexResult.version,
  }
}

export async function loadWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return getAllWhisperModelStatuses().catch(() => [])
}
