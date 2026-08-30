import { describe, expect, it } from 'vitest'
import {
  EventRateCounter,
  parseCpuTime,
  parseFootprintBytes,
  parseVmmapSummary,
} from './check-idle-resources.mjs'

describe('idle resource check', () => {
  it('parses cumulative ps CPU times including multi-day processes', () => {
    expect(parseCpuTime('01:02.50')).toBe(62.5)
    expect(parseCpuTime('2:03:04.25')).toBe(7_384.25)
    expect(parseCpuTime('3-02:03:04.25')).toBe(266_584.25)
  })

  it('parses vmmap current and peak physical footprints', () => {
    expect(parseFootprintBytes('1.5G')).toBe(1.5 * 1024 ** 3)
    expect(parseVmmapSummary(`Physical footprint:         392.7M\nPhysical footprint (peak):  4.2G\n`)).toEqual({
      currentBytes: 392.7 * 1024 ** 2,
      peakBytes: 4.2 * 1024 ** 3,
    })
    expect(parseVmmapSummary('Physical footprint: 12.0M\n').peakBytes).toBeNull()
  })

  it('counts fragmented SSE envelopes by event type and payload bytes', () => {
    const counter = new EventRateCounter()
    counter.accept('event: openforge-event\ndata: {"eventName":"pty-output-T-1","payload":{"data":"a"}}\n')
    counter.accept('\ndata: {"eventName":"task-changed","payload":{"task_id":"T-1"}}\n\n')

    expect(counter.events).toBe(2)
    expect(counter.topEventTypes()).toEqual([
      { eventName: 'pty-output-T-1', count: 1 },
      { eventName: 'task-changed', count: 1 },
    ])
    expect(counter.payloadBytes).toBeGreaterThan(0)
  })
})
