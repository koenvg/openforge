import type { AgentPanelStatus } from './agentPanelSessionSync'

export type AgentStageLabels = Record<string, string>
export type AgentSessionStatusBadgeVariant = 'soft' | 'badge'

export function getAgentStatusText(status: AgentPanelStatus, runningText: string | null): string | null {
  switch (status) {
    case 'idle': return 'No active implementation'
    case 'running': return runningText
    case 'paused': return 'Agent paused'
    case 'complete': return null
    case 'error': return 'Error occurred'
  }
}

export function getAgentStageLabel(stage: string, stageLabels: AgentStageLabels): string {
  return stageLabels[stage] || stage
}

export function getAgentSessionStatusBadgeClass(sessionStatus: string, variant: AgentSessionStatusBadgeVariant): string {
  switch (sessionStatus) {
    case 'running': return variant === 'soft' ? 'bg-success/10 text-success' : 'badge-success'
    case 'completed': return 'badge-primary'
    case 'failed': return 'badge-error'
    case 'interrupted': return 'badge-ghost'
    case 'paused': return 'badge-warning'
    default: return 'badge-ghost'
  }
}
