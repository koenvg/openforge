import { describe, expect, it } from 'vitest'
import { isSidecarBackedCommand } from './backendBridge'

describe('Electron backend bridge routing contracts', () => {
  it('keeps unknown commands off the sidecar route', () => {
    expect(isSidecarBackedCommand('unknown_command')).toBe(false)
  })

  it.each([
    'finalize_claude_session',
    'merge_pull_request',
    'enqueue_pull_request',
    'start_agent_review',
    'list_opencode_skills',
    'save_skill_content',
    'dismiss_all_agent_review_comments',
    'abort_agent_review',
  ])('keeps retired command %s off the sidecar route', (command) => {
    expect(isSidecarBackedCommand(command)).toBe(false)
  })
})
