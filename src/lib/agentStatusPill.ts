import type { AgentSession } from './types'
import type { AgentPanelStatus } from './agentPanelSessionSync'
import { getAgentStageLabel, getAgentStatusText, type AgentStageLabels } from './agentTerminalPanel'
import { getAgentResumeCommand, type AgentResumeCommandProvider } from './agentResumeCommand'
import { parseCheckpointQuestion } from './parseCheckpoint'

type ProviderSessionIdKey = 'opencode_session_id' | 'claude_session_id' | 'pi_session_id'

export interface AgentProviderConfig {
  runningText: string
  sessionIdKey: ProviderSessionIdKey | null
  stageLabels: AgentStageLabels
  stageLabelPrefix: string
  uppercaseSessionStatus: boolean
  resumeCommandProvider: AgentResumeCommandProvider
}

export interface AgentStatusPillView {
  statusText: string
  stageLabel: string
  sessionStatus: string
  sessionStatusLabel: string
  resumeCommand: string | null
  checkpointActive: boolean
}

const SHARED_STAGE_LABELS: AgentStageLabels = {
  read_ticket: 'reading ticket',
  implement: 'implementing',
  create_pr: 'creating PR',
  address_comments: 'addressing comments',
}

const OPENCODE_STAGE_LABELS: AgentStageLabels = {
  read_ticket: 'Reading Ticket',
  implement: 'Implementing',
  create_pr: 'Creating PR',
  address_comments: 'Addressing Comments',
}

/**
 * Resolve the provider-specific chrome for the agent status pill. Mirrors the
 * provider branches in AgentPanel so the control-row pill and the terminal shell
 * stay in lock-step.
 */
export function getAgentProviderConfig(provider: string | null): AgentProviderConfig {
  switch (provider) {
    case 'claude-code':
      return { runningText: 'Claude agent running...', sessionIdKey: 'claude_session_id', stageLabels: SHARED_STAGE_LABELS, stageLabelPrefix: '// ', uppercaseSessionStatus: true, resumeCommandProvider: 'claude-code' }
    case 'pi':
      return { runningText: 'Pi agent running...', sessionIdKey: 'pi_session_id', stageLabels: SHARED_STAGE_LABELS, stageLabelPrefix: '// ', uppercaseSessionStatus: true, resumeCommandProvider: 'pi' }
    case 'codex':
      return { runningText: 'Codex agent running...', sessionIdKey: null, stageLabels: SHARED_STAGE_LABELS, stageLabelPrefix: '// ', uppercaseSessionStatus: true, resumeCommandProvider: 'codex' }
    default:
      return { runningText: 'Agent running...', sessionIdKey: 'opencode_session_id', stageLabels: OPENCODE_STAGE_LABELS, stageLabelPrefix: '', uppercaseSessionStatus: false, resumeCommandProvider: 'opencode' }
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
  const providerSessionId = config.sessionIdKey ? session[config.sessionIdKey] : null
  const checkpointActive = config.sessionIdKey === 'opencode_session_id'
    && session.status === 'paused'
    && parseCheckpointQuestion(session.checkpoint_data) !== null

  return {
    statusText: getAgentStatusText(status, config.runningText),
    stageLabel: `${config.stageLabelPrefix}${getAgentStageLabel(session.stage, config.stageLabels)}`,
    sessionStatus: session.status,
    sessionStatusLabel: config.uppercaseSessionStatus ? session.status.toUpperCase() : session.status,
    resumeCommand: getAgentResumeCommand(config.resumeCommandProvider, providerSessionId),
    checkpointActive,
  }
}
