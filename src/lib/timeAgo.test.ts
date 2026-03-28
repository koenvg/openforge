import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { timeAgo, timeAgoFromSeconds, relativeTimeWithFallback } from './timeAgo'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-28T09:30:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

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

describe('relativeTimeWithFallback', () => {
  it('returns "just now" for timestamps within 60 seconds', () => {
    const thirtySecondsAgoSeconds = Math.floor(Date.now() / 1000) - 30
    expect(relativeTimeWithFallback(thirtySecondsAgoSeconds)).toBe('just now')
  })

  it('returns "5m ago" for 5 minutes ago', () => {
    const fiveMinutesAgoSeconds = Math.floor(Date.now() / 1000) - 300
    expect(relativeTimeWithFallback(fiveMinutesAgoSeconds)).toBe('5m ago')
  })

  it('returns "2h ago" for 2 hours ago', () => {
    const twoHoursAgoSeconds = Math.floor(Date.now() / 1000) - 7200
    expect(relativeTimeWithFallback(twoHoursAgoSeconds)).toBe('2h ago')
  })

  it('returns "6d ago" for 6 days ago', () => {
    const sixDaysAgoSeconds = Math.floor(Date.now() / 1000) - 518400
    expect(relativeTimeWithFallback(sixDaysAgoSeconds)).toBe('6d ago')
  })

  it('returns "Mar 21" (date format) for exactly 7 days ago', () => {
    const sevenDaysAgoSeconds = Math.floor(Date.now() / 1000) - 604800
    const result = relativeTimeWithFallback(sevenDaysAgoSeconds)
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    expect(result).toBe('Mar 21')
  })

  it('returns "Mar 14" (date format) for 14 days ago', () => {
    const fourteenDaysAgoSeconds = Math.floor(Date.now() / 1000) - 1209600
    const result = relativeTimeWithFallback(fourteenDaysAgoSeconds)
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
    expect(result).toBe('Mar 14')
  })

  it('switches to date format (no year) at exactly 7-day boundary', () => {
    const almostSevenDaysSeconds = Math.floor(Date.now() / 1000) - 604799
    const almostSevenResult = relativeTimeWithFallback(almostSevenDaysSeconds)
    expect(almostSevenResult).toBe('6d ago')

    const sevenDaysSeconds = Math.floor(Date.now() / 1000) - 604800
    const sevenDaysResult = relativeTimeWithFallback(sevenDaysSeconds)
    expect(sevenDaysResult).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/)
  })
})
