export type AgentResumeCommandProvider = 'opencode' | 'claude-code' | 'pi' | 'codex'

const RESUME_COMMANDS: Record<AgentResumeCommandProvider, { binary: string, flag: string }> = {
  opencode: { binary: 'opencode', flag: '--session' },
  'claude-code': { binary: 'claude', flag: '--resume' },
  pi: { binary: 'pi', flag: '--session' },
  codex: { binary: 'codex', flag: 'resume' },
}

export function getAgentResumeCommand(provider: AgentResumeCommandProvider, sessionId: string | null): string | null {
  const normalizedSessionId = sessionId?.trim()
  if (!normalizedSessionId) return null

  const command = RESUME_COMMANDS[provider]
  return `${command.binary} ${command.flag} ${normalizedSessionId}`
}
