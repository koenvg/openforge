import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { TicketSnapshot } from './ticketCoverage'

/**
 * Jira state owned by the github-sync plugin.
 *
 * Everything here lives in plugin storage so it disappears with the plugin. The
 * API token is the one exception: it sits in the OS keychain behind core's
 * `jira_api_token` secret and never passes through this module.
 */

export const JIRA_CONFIG_KEY = 'jira:config'

/** Non-secret Jira settings, as entered in the plugin's settings section. */
export interface JiraConfig {
  baseUrl: string
  email: string
  /** Raw comma-separated input; parsed by `parseProjectKeys` at use sites. */
  projectKeys: string
  /**
   * Custom field holding acceptance criteria, e.g. `customfield_12100`. The id
   * differs per Jira instance, so it is configuration rather than a constant.
   * Blank means the criteria are read from the description instead.
   */
  acFieldId: string
}

export const EMPTY_JIRA_CONFIG: JiraConfig = {
  baseUrl: '',
  email: '',
  projectKeys: '',
  acFieldId: '',
}

/**
 * Keyed by PR rather than head SHA: which ticket a PR implements does not change
 * when the author pushes another commit.
 */
export function jiraKeyOverrideStorageKey(prId: number): string {
  return `jira:key:${prId}`
}

/**
 * Keyed by head SHA as well, so a re-fetch for a new commit cannot silently
 * reuse the ticket snapshot taken for the previous one.
 */
export function ticketSnapshotStorageKey(prId: number, headSha: string): string {
  return `jira:ticket:${prId}:${headSha}`
}

/**
 * Whether the gap analysis should run at all. The token lives in the keychain,
 * so its presence is reported separately by core rather than read from here.
 */
export function isJiraConfigured(config: JiraConfig | null, tokenConfigured: boolean): boolean {
  if (!config || !tokenConfigured) return false
  return config.baseUrl.trim().length > 0 && config.email.trim().length > 0
}

export async function readJiraConfig(openforge: BackendOpenForgeAPI): Promise<JiraConfig> {
  const stored = await openforge.storage.global.get<JsonValue>(JIRA_CONFIG_KEY)
  const record = (stored ?? null) as Partial<JiraConfig> | null
  if (!record) return EMPTY_JIRA_CONFIG

  return {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    email: typeof record.email === 'string' ? record.email : '',
    projectKeys: typeof record.projectKeys === 'string' ? record.projectKeys : '',
    acFieldId: typeof record.acFieldId === 'string' ? record.acFieldId : '',
  }
}

export async function writeJiraConfig(
  openforge: BackendOpenForgeAPI,
  config: JiraConfig,
): Promise<void> {
  // Field-by-field rather than spreading `config`, so a caller that hands us a
  // wider object (a form model carrying the token, say) cannot persist a secret.
  await openforge.storage.global.set(JIRA_CONFIG_KEY, {
    baseUrl: config.baseUrl,
    email: config.email,
    projectKeys: config.projectKeys,
    acFieldId: config.acFieldId,
  })
}

export async function readJiraKeyOverride(
  openforge: BackendOpenForgeAPI,
  prId: number,
): Promise<string | null> {
  const stored = await openforge.storage.global.get<JsonValue>(jiraKeyOverrideStorageKey(prId))
  const issueKey = (stored as { issueKey?: unknown } | null)?.issueKey
  return typeof issueKey === 'string' && issueKey.length > 0 ? issueKey : null
}

export async function writeJiraKeyOverride(
  openforge: BackendOpenForgeAPI,
  prId: number,
  issueKey: string | null,
): Promise<void> {
  const key = jiraKeyOverrideStorageKey(prId)
  const trimmed = issueKey?.trim()
  if (!trimmed) {
    await openforge.storage.global.delete(key)
    return
  }
  await openforge.storage.global.set(key, { issueKey: trimmed.toUpperCase() })
}

export async function readTicketSnapshot(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
): Promise<TicketSnapshot | null> {
  const stored = await openforge.storage.global.get<JsonValue>(
    ticketSnapshotStorageKey(prId, headSha),
  )
  return (stored as TicketSnapshot | null) ?? null
}

export async function writeTicketSnapshot(
  openforge: BackendOpenForgeAPI,
  prId: number,
  headSha: string,
  snapshot: TicketSnapshot,
): Promise<void> {
  await openforge.storage.global.set(
    ticketSnapshotStorageKey(prId, headSha),
    snapshot as unknown as JsonValue,
  )
}
