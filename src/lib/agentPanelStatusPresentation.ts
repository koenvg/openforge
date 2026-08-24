import type { AgentPanelStatus } from './agentPanelSessionSync'

export function getAgentStatusText(status: AgentPanelStatus, runningText: string | null): string | null {
  switch (status) {
    case 'idle': return 'No active implementation'
    case 'running': return runningText
    case 'paused': return 'Agent paused'
    case 'complete': return null
    case 'error': return 'Error occurred'
  }
}
