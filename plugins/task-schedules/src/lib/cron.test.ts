import { describe, expect, it } from 'vitest'
import { cronForPreset, getNextScheduledFireAt, timeOfDayFromCron, validateFiveFieldCron } from './cron'

describe('Task Schedule cron utilities', () => {
  it('compiles Schedule Presets with a selected time to private five-field cron expressions', () => {
    expect(cronForPreset('daily', '14:30')).toBe('30 14 * * *')
    expect(cronForPreset('weekly', '08:05')).toBe('5 8 * * 1')
    expect(cronForPreset('monthly', '23:45')).toBe('45 23 1 * *')
  })

  it('defaults Schedule Presets to 09:00 when no time is provided', () => {
    expect(cronForPreset('daily')).toBe('0 9 * * *')
  })

  it('derives the time picker value from simple preset cron expressions', () => {
    expect(timeOfDayFromCron('30 14 * * *')).toBe('14:30')
    expect(timeOfDayFromCron('5 8 * * 1')).toBe('08:05')
    expect(timeOfDayFromCron('*/15 * * * *')).toBe('09:00')
  })

  it('validates custom five-field cron syntax without accepting nicknames', () => {
    expect(validateFiveFieldCron('*/15 8-17 * * 1,3,5').valid).toBe(true)
    expect(validateFiveFieldCron('@daily').valid).toBe(false)
    expect(validateFiveFieldCron('0 9 * *').valid).toBe(false)
  })

  it('finds the next Scheduled Fire strictly after the provided time', () => {
    const next = getNextScheduledFireAt('0 9 * * *', Date.UTC(2026, 0, 1, 9, 0, 0))
    expect(next).toBe(Date.UTC(2026, 0, 2, 9, 0, 0))
  })
})
