import { describe, it, expect } from 'vitest'
import { timeAgo, timeAgoFromSeconds } from './timeAgo'

describe('timeAgo', () => {
  it('returns "just now" for timestamps within 60 seconds', () => {
    const thirtySecondsAgo = Date.now() - 30000
    expect(timeAgo(thirtySecondsAgo)).toBe('just now')
  })

  it('returns "just now" for current timestamp', () => {
    expect(timeAgo(Date.now())).toBe('just now')
  })

  it('returns "just now" for timestamps just under 60 seconds', () => {
    const fiftyNinePointNineNineSecondsAgo = Date.now() - 59999
    expect(timeAgo(fiftyNinePointNineNineSecondsAgo)).toBe('just now')
  })

  it('returns "1m ago" for exactly 60 seconds', () => {
    const oneMinuteAgo = Date.now() - 60000
    expect(timeAgo(oneMinuteAgo)).toBe('1m ago')
  })

  it('returns "5m ago" for 5 minutes', () => {
    const fiveMinutesAgo = Date.now() - 300000
    expect(timeAgo(fiveMinutesAgo)).toBe('5m ago')
  })

  it('returns "1h ago" for exactly 1 hour', () => {
    const oneHourAgo = Date.now() - 3600000
    expect(timeAgo(oneHourAgo)).toBe('1h ago')
  })

  it('returns "2h ago" for 2 hours', () => {
    const twoHoursAgo = Date.now() - 7200000
    expect(timeAgo(twoHoursAgo)).toBe('2h ago')
  })

  it('returns "1d ago" for exactly 1 day', () => {
    const oneDayAgo = Date.now() - 86400000
    expect(timeAgo(oneDayAgo)).toBe('1d ago')
  })

  it('returns "2d ago" for 2 days', () => {
    const twoDaysAgo = Date.now() - 172800000
    expect(timeAgo(twoDaysAgo)).toBe('2d ago')
  })
})

describe('timeAgoFromSeconds', () => {
  it('returns "just now" for current timestamp in seconds', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    expect(timeAgoFromSeconds(nowSeconds)).toBe('just now')
  })

  it('returns "5m ago" for 5 minutes ago in seconds', () => {
    const fiveMinutesAgoSeconds = Math.floor(Date.now() / 1000) - 300
    expect(timeAgoFromSeconds(fiveMinutesAgoSeconds)).toBe('5m ago')
  })

  it('returns "2h ago" for 2 hours ago in seconds', () => {
    const twoHoursAgoSeconds = Math.floor(Date.now() / 1000) - 7200
    expect(timeAgoFromSeconds(twoHoursAgoSeconds)).toBe('2h ago')
  })

  it('returns "1d ago" for 1 day ago in seconds', () => {
    const oneDayAgoSeconds = Math.floor(Date.now() / 1000) - 86400
    expect(timeAgoFromSeconds(oneDayAgoSeconds)).toBe('1d ago')
  })

  it('does not return thousands of days for recent timestamps', () => {
    const oneDayAgoSeconds = Math.floor(Date.now() / 1000) - 86400
    const result = timeAgoFromSeconds(oneDayAgoSeconds)
    const match = result.match(/(\d+)d ago/)
    if (match) {
      expect(Number(match[1])).toBeLessThan(365)
    }
  })
})
