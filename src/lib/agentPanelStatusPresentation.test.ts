import { describe, expect, it } from 'vitest'

import { getAgentStatusText } from './agentPanelStatusPresentation'

describe('agent panel status presentation', () => {
  it('keeps provider-specific status text configurable', () => {
    expect(getAgentStatusText('idle', 'Claude agent running...')).toBe('No active implementation')
    expect(getAgentStatusText('running', 'Claude agent running...')).toBe('Claude agent running...')
    expect(getAgentStatusText('running', 'Pi agent running...')).toBe('Pi agent running...')
    expect(getAgentStatusText('running', 'Agent running...')).toBe('Agent running...')
    expect(getAgentStatusText('paused', 'Claude agent running...')).toBe('Agent paused')
    expect(getAgentStatusText('complete', 'Agent running...')).toBeNull()
    expect(getAgentStatusText('error', 'Agent running...')).toBe('Error occurred')
  })
})
