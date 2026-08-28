import { loadFocusFilterStates } from './boardFilters'
import {
  checkClaudeInstalled,
  checkCodexInstalled,
  checkGrokInstalled,
  checkOpenCodeInstalled,
  checkPiInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
} from './ipc'
import { RUN_COMMAND_CONFIG_KEY } from './runAppCommand'
import { HIERARCHICAL_SETTINGS } from './hierarchicalSettings'
import { DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE } from './prGuidanceDefaults'
import type { TaskState } from './taskState'
import type { ClaudeInstallStatus, WhisperModelStatus } from './types'

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
  aiProvider: string
  useWorktrees: boolean
  runCommand: string
  focusFilterStates: TaskState[]
}

export interface GlobalSettingsConfig {
  taskIdPrefix: string
  githubToken: string
  taskDisplayTitleMetadataUpdatesEnabled: boolean
  githubPollInterval: number
  useWorktrees: boolean
  aiProvider: string
  reviewGuidance: string
  walkthroughGuidance: string
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
  grokInstalled: boolean
  grokVersion: string | null
  grokAuthenticated: boolean
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

const DEFAULT_PROJECT_SETTINGS: Omit<ProjectSettingsConfig, 'focusFilterStates'> = {
  agentInstructions: '',
  aiProvider: 'claude-code',
  useWorktrees: true,
  runCommand: '',
}

const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsConfig = {
  taskIdPrefix: '',
  githubToken: '',
  taskDisplayTitleMetadataUpdatesEnabled: false,
  githubPollInterval: DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
  useWorktrees: true,
  aiProvider: 'claude-code',
  reviewGuidance: DEFAULT_PR_REVIEW_GUIDANCE,
  walkthroughGuidance: DEFAULT_PR_WALKTHROUGH_GUIDANCE,
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettingsConfig> {
  const [instructions, provider, useWorktrees, runCommand, focusFilterStates] = await Promise.all([
    getProjectConfig(projectId, 'additional_instructions'),
    getProjectConfig(projectId, 'ai_provider'),
    getProjectConfig(projectId, 'use_worktrees'),
    getProjectConfig(projectId, RUN_COMMAND_CONFIG_KEY),
    loadFocusFilterStates(projectId),
  ])

  return {
    agentInstructions: instructions ?? DEFAULT_PROJECT_SETTINGS.agentInstructions,
    aiProvider: provider ?? DEFAULT_PROJECT_SETTINGS.aiProvider,
    useWorktrees: useWorktrees == null ? DEFAULT_PROJECT_SETTINGS.useWorktrees : useWorktrees === 'true',
    runCommand: runCommand ?? DEFAULT_PROJECT_SETTINGS.runCommand,
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
  const [
    taskIdPrefix,
    githubToken,
    taskDisplayTitleMetadataUpdatesEnabled,
    githubPollInterval,
    useWorktrees,
    aiProvider,
    reviewGuidance,
    walkthroughGuidance,
  ] = await Promise.all([
    getConfig('task_id_prefix'),
    getConfig('github_token'),
    getConfig('task_display_title_metadata_updates_enabled'),
    getConfig('github_poll_interval'),
    getConfig('use_worktrees'),
    getConfig('ai_provider'),
    getConfig('pr_review_guidance'),
    getConfig('pr_walkthrough_guidance'),
  ])

  return {
    taskIdPrefix: taskIdPrefix ?? DEFAULT_GLOBAL_SETTINGS.taskIdPrefix,
    githubToken: githubToken ?? DEFAULT_GLOBAL_SETTINGS.githubToken,
    taskDisplayTitleMetadataUpdatesEnabled: taskDisplayTitleMetadataUpdatesEnabled === 'true',
    githubPollInterval: parseGitHubPollIntervalSeconds(githubPollInterval),
    useWorktrees: useWorktrees == null ? DEFAULT_GLOBAL_SETTINGS.useWorktrees : useWorktrees === 'true',
    aiProvider: aiProvider ?? DEFAULT_GLOBAL_SETTINGS.aiProvider,
    // Present-but-empty is a deliberate "no extra guidance", so only a missing
    // key falls back to the shipped default.
    reviewGuidance: reviewGuidance ?? DEFAULT_GLOBAL_SETTINGS.reviewGuidance,
    walkthroughGuidance: walkthroughGuidance ?? DEFAULT_GLOBAL_SETTINGS.walkthroughGuidance,
  }
}

export async function loadInstallationStatus(): Promise<InstallationStatus> {
  const [opencodeResult, claudeResult, piResult, codexResult, grokResult] = await Promise.all([
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
    checkGrokInstalled().catch(() => ({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
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
    grokInstalled: grokResult.installed,
    grokVersion: grokResult.version,
    grokAuthenticated: grokResult.authenticated,
  }
}

export async function loadWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return getAllWhisperModelStatuses().catch(() => [])
}
