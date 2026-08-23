import { describe, expect, it } from 'vitest'

import {
  getAgentSessionStatusBadgeClass,
  getAgentStageLabel,
  getAgentStatusText,
} from './agentPanelStatusPresentation'

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

  it('formats shared lifecycle stages with provider-specific label maps', () => {
    const lowerCaseLabels = {
      read_ticket: 'reading ticket',
      implement: 'implementing',
      create_pr: 'creating PR',
      address_comments: 'addressing comments',
    }
    const titleCaseLabels = {
      read_ticket: 'Reading Ticket',
      implement: 'Implementing',
      create_pr: 'Creating PR',
      address_comments: 'Addressing Comments',
    }

    expect(getAgentStageLabel('implement', lowerCaseLabels)).toBe('implementing')
    expect(getAgentStageLabel('implement', titleCaseLabels)).toBe('Implementing')
    expect(getAgentStageLabel('custom_stage', lowerCaseLabels)).toBe('custom_stage')
  })

  it('maps session statuses to badge classes for both variants', () => {
    expect(getAgentSessionStatusBadgeClass('running', 'soft')).toBe('bg-success/10 text-success')
    expect(getAgentSessionStatusBadgeClass('running', 'badge')).toBe('badge-success')
    expect(getAgentSessionStatusBadgeClass('completed', 'badge')).toBe('badge-primary')
    expect(getAgentSessionStatusBadgeClass('failed', 'badge')).toBe('badge-error')
    expect(getAgentSessionStatusBadgeClass('interrupted', 'badge')).toBe('badge-ghost')
    expect(getAgentSessionStatusBadgeClass('paused', 'badge')).toBe('badge-warning')
    expect(getAgentSessionStatusBadgeClass('unknown', 'badge')).toBe('badge-ghost')
  })
})
