export * from '@openforge-app/plugin-sdk/domain'

import type { AppView, ReviewPullRequest, TaskAttentionRow } from '@openforge-app/plugin-sdk/domain'

/**
 * Every startable task, split into the four board lanes. Keys are the backend's snake_case
 * lane names; `laneRowsByFilter` maps them onto the renderer's `BoardFilter` ids.
 */
export interface TaskLaneRows {
  focus: TaskAttentionRow[]
  in_flight: TaskAttentionRow[]
  out_of_focus: TaskAttentionRow[]
  backlog: TaskAttentionRow[]
}

/**
 * A project's last-viewed in-project location: the active tab plus whichever task
 * or PR was open within it. Kept per-project (in memory) so switching away and
 * returning lands the user back where they were instead of on the board.
 */
export interface ProjectViewSnapshot {
  currentView: AppView
  selectedTaskId: string | null
  selectedReviewPr: ReviewPullRequest | null
}

export type DeveloperLogLevel = 'info' | 'warn' | 'error'

export interface DeveloperLogEntry {
  id: number
  timestamp: string
  level: DeveloperLogLevel
  message: string
}

export interface DeveloperLogSnapshot {
  entries: DeveloperLogEntry[]
  logFilePath: string
  totalEntries: number
}

export interface ProcessMemoryHistorySample {
  collectedAt: string
  electronTotalTreeRssBytes: number
  sidecarTotalTreeRssBytes: number
  managedPtyTotalTreeRssBytes: number
  pluginHostTotalTreeRssBytes: number
  trackedUniqueRssBytes: number
}

export interface ProcessMemoryHistorySnapshot {
  enabled: boolean
  sampleIntervalSeconds: number
  maxSamples: number
  rssSemantics: string
  samples: ProcessMemoryHistorySample[]
}

export interface GitStatusSummary {
  has_remote: boolean
  remote_ahead: number
  remote_behind: number
  local_commits: number
  uncommitted_files: number
  insertions: number
  deletions: number
  untracked_files: number
  untracked_insertions: number
}

export type CompanionGatewayPhase = 'disabled' | 'starting' | 'running' | 'error' | 'stopped'
export type CompanionGatewayEndpointKind = 'lan' | 'tailscale'

export interface CompanionGatewayEndpoint {
  kind: CompanionGatewayEndpointKind
  url: string
}

export interface CompanionTailscaleStatus {
  detectedHostname: string | null
  configuredHostname: string | null
  effectiveHostname: string | null
}

export interface CompanionGatewayStatus {
  enabled: boolean
  phase: CompanionGatewayPhase
  hostId: string | null
  certificateFingerprint: string | null
  endpoints: CompanionGatewayEndpoint[]
  tailscale: CompanionTailscaleStatus
  error: string | null
}

export interface CompanionPendingPairingRequest {
  requestId: string
  deviceName: string
  platform: 'ios' | 'android'
}

export interface CompanionPairingSession {
  sessionId: string
  expiresAt: string
  qrPayload: string
  pendingRequest: CompanionPendingPairingRequest | null
  deliveryPending: boolean
}

export interface CompanionPairedDevice {
  deviceId: string
  deviceName: string
  platform: 'ios' | 'android'
  pairedAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}
