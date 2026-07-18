import type { ProjectAttention } from './types'

/**
 * True when any project has an agent that quitting would abruptly terminate:
 * one that is actively running, or paused waiting for the user's input. Used to
 * decide whether closing the app needs a confirmation prompt — when nothing is
 * active, the app can quit straight away.
 *
 * `attention` is the global per-project attention map, so this reflects agents
 * across every project, not just the one currently on screen.
 */
export function hasActiveAgentSessions(attention: Map<string, ProjectAttention>): boolean {
  for (const entry of attention.values()) {
    if (entry.running_agents > 0 || entry.needs_input > 0) return true
  }
  return false
}
