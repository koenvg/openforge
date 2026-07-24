import { describe, expect, it } from 'vitest'
import { MINIMUM_FIRE_INTERVAL_MS, cronForPreset, dayOfWeekFromCron, describeCronExpression, getNextScheduledFireAt, timeOfDayFromCron, validateCronCadence, validateFiveFieldCron } from './cron'

describe('Task Schedule cron utilities', () => {
  it('compiles Schedule Presets with a selected time to private five-field cron expressions', () => {
    expect(cronForPreset('daily', '14:30')).toBe('30 14 * * *')
    expect(cronForPreset('weekly', '08:05')).toBe('5 8 * * 1')
    expect(cronForPreset('monthly', '23:45')).toBe('45 23 1 * *')
  })

  it('defaults Schedule Presets to 09:00 when no time is provided', () => {
    expect(cronForPreset('daily')).toBe('0 9 * * *')
  })

  it('compiles weekly Schedule Presets with a selected day and keeps Monday as the default', () => {
    expect(cronForPreset('weekly', '10:15')).toBe('15 10 * * 1')
    expect(cronForPreset('weekly', '10:15', 5)).toBe('15 10 * * 5')
    expect(cronForPreset('weekly', '10:15', 7)).toBe('15 10 * * 0')
  })

  it('derives the time picker value from simple preset cron expressions', () => {
    expect(timeOfDayFromCron('30 14 * * *')).toBe('14:30')
    expect(timeOfDayFromCron('5 8 * * 1')).toBe('08:05')
    expect(timeOfDayFromCron('*/15 * * * *')).toBe('09:00')
  })

  it('derives the weekly day picker value from simple weekly cron expressions', () => {
    expect(dayOfWeekFromCron('30 14 * * 5')).toBe(5)
    expect(dayOfWeekFromCron('0 9 * * 7')).toBe(0)
    expect(dayOfWeekFromCron('*/15 * * * *')).toBe(1)
    expect(dayOfWeekFromCron('0 9 * * 1,3')).toBe(1)
  })

  it('validates custom five-field cron syntax without accepting nicknames', () => {
    expect(validateFiveFieldCron('*/15 8-17 * * 1,3,5').valid).toBe(true)
    expect(validateFiveFieldCron('@daily').valid).toBe(false)
    expect(validateFiveFieldCron('0 9 * *').valid).toBe(false)
  })

  it('finds the next Scheduled Fire strictly after the provided time', () => {
    const next = getNextScheduledFireAt('0 9 * * *', new Date(2026, 0, 1, 9, 0, 0).getTime())
    expect(next).toBe(new Date(2026, 0, 2, 9, 0, 0).getTime())
  })

  it('interprets custom cron expressions in local time when finding the next Scheduled Fire', () => {
    const previousTimeZone = process.env.TZ
    process.env.TZ = 'Europe/Amsterdam'
    try {
      const after = new Date(2026, 6, 4, 10, 1, 0).getTime()
      const next = getNextScheduledFireAt('*/30 9-16 * * *', after)

      expect(next).toBe(new Date(2026, 6, 4, 10, 30, 0).getTime())
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = previousTimeZone
      }
    }
  })

  it('describes cron expressions in human language', () => {
    expect(describeCronExpression('*/30 9-16 * * *')).toMatch(/every 30 minutes/i)
    expect(describeCronExpression('*/30 9-16 * * *')).toMatch(/09:00.*16:59|09:00.*04:59 PM/i)
  })

  describe('minimum-cadence guard', () => {
    const from = new Date(2026, 0, 1, 0, 0, 0).getTime()

    it('exposes a five-minute minimum fire interval', () => {
      expect(MINIMUM_FIRE_INTERVAL_MS).toBe(5 * 60_000)
    })

    it('rejects cron expressions that fire more often than once every five minutes', () => {
      expect(validateCronCadence('* * * * *', from).valid).toBe(false)
      expect(validateCronCadence('*/4 * * * *', from).valid).toBe(false)
      expect(validateCronCadence('0,1 * * * *', from).valid).toBe(false)
    })

    it('rejects fast fires that only appear at an hour boundary', () => {
      // Fires at :00 and :59 every hour, so :59 -> next :00 is a one-minute gap.
      expect(validateCronCadence('0,59 * * * *', from).valid).toBe(false)
    })

    it('surfaces a human-readable reason when a cron fires too often', () => {
      const result = validateCronCadence('* * * * *', from)
      expect(result.error).toMatch(/5 minutes/i)
    })

    it('accepts cadences at or below the five-minute threshold', () => {
      expect(validateCronCadence('*/5 * * * *', from)).toEqual({ valid: true, error: null })
      expect(validateCronCadence('*/30 9-16 * * *', from)).toEqual({ valid: true, error: null })
      expect(validateCronCadence('0,30 * * * *', from)).toEqual({ valid: true, error: null })
      expect(validateCronCadence('0 9 * * *', from)).toEqual({ valid: true, error: null })
    })

    it('rejects sparse fast pairs outside the sampling year', () => {
      const afterFirstFire = new Date(2028, 1, 29, 0, 0, 30).getTime()
      expect(validateCronCadence('0,4 0 29 2 *', afterFirstFire).valid).toBe(false)
    })

    it('rejects overnight fast pairs that first align after the sampling year', () => {
      expect(validateCronCadence('0,59 0,23 1,2 1 0,6', from).valid).toBe(false)
    })

    it('handles spring-forward gaps without counting normalized local times twice', () => {
      const previousTimeZone = process.env.TZ
      process.env.TZ = 'Europe/Amsterdam'
      try {
        const beforeSpringForward = new Date(2026, 2, 28, 0, 0, 0).getTime()
        expect(validateCronCadence('30 2,3 * * *', beforeSpringForward)).toEqual({ valid: true, error: null })
        expect(validateCronCadence('0,59 1,3 * * *', beforeSpringForward).valid).toBe(false)

        const beforeSparseAlignment = new Date(2026, 0, 1, 0, 0, 0).getTime()
        expect(validateCronCadence('0,59 1,3 31 3 0', beforeSparseAlignment).valid).toBe(false)
      } finally {
        if (previousTimeZone === undefined) {
          delete process.env.TZ
        } else {
          process.env.TZ = previousTimeZone
        }
      }
    })

    it('ignores timezone transitions that occurred before validation starts', () => {
      const previousTimeZone = process.env.TZ
      process.env.TZ = 'America/Mexico_City'
      try {
        const afterLastSpringForward = new Date(2022, 10, 1, 0, 0, 0).getTime()
        expect(validateCronCadence('0,59 1,3 3 4 0', afterLastSpringForward)).toEqual({ valid: true, error: null })
      } finally {
        if (previousTimeZone === undefined) {
          delete process.env.TZ
        } else {
          process.env.TZ = previousTimeZone
        }
      }
    })
  })
})
