import type { AgentSession } from './types'
import type { AgentPanelStatus } from './agentPanelSessionSync'
import { getAgentStatusText } from './agentTerminalPanel'
import { parseCheckpointQuestion } from './parseCheckpoint'

export interface AgentProviderConfig {
  supportsCheckpointQuestion: boolean
}

export interface AgentStatusPillView {
  statusText: string | null
  checkpointActive: boolean
}

/**
 * Resolve provider capabilities needed by the agent status pill.
 */
export function getAgentProviderConfig(provider: string | null): AgentProviderConfig {
  switch (provider) {
    case 'claude-code':
    case 'pi':
    case 'codex':
    case 'grok':
      return { supportsCheckpointQuestion: false }
    default:
      return { supportsCheckpointQuestion: true }
  }
}

/**
 * Compute the display data for the control-row agent status pill, or `null` when
 * there is no session. `status` is the live AgentPanelStatus (synced from the
 * session store + agent-status-changed events by the component).
 */
export function deriveAgentStatusPillView(session: AgentSession | null, status: AgentPanelStatus): AgentStatusPillView | null {
  if (!session) return null

  const config = getAgentProviderConfig(session.provider)
  const checkpointActive = config.supportsCheckpointQuestion
    && session.status === 'paused'
    && parseCheckpointQuestion(session.checkpoint_data) !== null

  return {
    statusText: getAgentStatusText(status, null),
    checkpointActive,
  }
}
