import { describe, expect, it } from 'vitest'
import { sendAgentFollowUp } from './ipc'
import { notifySessionMessageSent } from './openAttentionOnSessionSubmit'

describe('open-attention-on-send import graph', () => {
  it('loads the ipc barrel and session-submit helper without circular initialization', () => {
    expect(typeof sendAgentFollowUp).toBe('function')
    expect(typeof notifySessionMessageSent).toBe('function')
  })
})
