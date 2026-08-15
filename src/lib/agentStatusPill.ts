import type { AgentSession } from './types'
import type { AgentPanelStatus } from './agentPanelSessionSync'
import { getAgentStatusText } from './agentTerminalPanel'
import { parseCheckpointQuestion } from './parseCheckpoint'

export interface AgentProviderConfig {
  runningText: string
  supportsCheckpointQuestion: boolean
}

export interface AgentStatusPillView {
  statusText: string
  checkpointActive: boolean
}

/**
 * Resolve the provider-specific chrome for the agent status pill. Mirrors the
 * provider branches in AgentPanel so the control-row pill and the terminal shell
 * stay in lock-step.
 */
export function getAgentProviderConfig(provider: string | null): AgentProviderConfig {
  switch (provider) {
    case 'claude-code':
      return { runningText: 'Claude agent running...', supportsCheckpointQuestion: false }
    case 'pi':
      return { runningText: 'Pi agent running...', supportsCheckpointQuestion: false }
    case 'codex':
      return { runningText: 'Codex agent running...', supportsCheckpointQuestion: false }
    case 'grok':
      return { runningText: 'Grok agent running...', supportsCheckpointQuestion: false }
    default:
      return { runningText: 'Agent running...', supportsCheckpointQuestion: true }
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
    statusText: getAgentStatusText(status, config.runningText),
    checkpointActive,
  }
}
