import type { AgentSession } from './types'

export type AgentResumeCommandProvider = 'opencode' | 'claude-code' | 'pi' | 'codex'

type ProviderSessionIdKey = 'opencode_session_id' | 'claude_session_id' | 'pi_session_id'

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

export function getAgentSessionResumeCommand(session: AgentSession | null): string | null {
  if (!session) return null

  const providerSessionKeys: Partial<Record<AgentResumeCommandProvider, ProviderSessionIdKey>> = {
    opencode: 'opencode_session_id',
    'claude-code': 'claude_session_id',
    pi: 'pi_session_id',
  }
  const provider = session.provider as AgentResumeCommandProvider
  const sessionIdKey = providerSessionKeys[provider]
  if (!sessionIdKey) return null

  return getAgentResumeCommand(provider, session[sessionIdKey])
}
