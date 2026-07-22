import cronstrue from 'cronstrue'
import type { SchedulePreset } from './types'

const FIELD_LIMITS = [
  { min: 0, max: 59, name: 'minute' },
  { min: 0, max: 23, name: 'hour' },
  { min: 1, max: 31, name: 'day of month' },
  { min: 1, max: 12, name: 'month' },
  { min: 0, max: 7, name: 'day of week' },
] as const

type CronField = {
  wildcard: boolean
  values: Set<number>
}

type ParsedCron = [CronField, CronField, CronField, CronField, CronField]

export function cronForPreset(preset: Exclude<SchedulePreset, 'custom'>, timeOfDay = '09:00', dayOfWeek = 1): string {
  const { hour, minute } = parseTimeOfDay(timeOfDay)
  switch (preset) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${normalizeDayOfWeek(dayOfWeek)}`
    case 'monthly':
      return `${minute} ${hour} 1 * *`
  }
}

export function timeOfDayFromCron(cron: string): string {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) {
    return '09:00'
  }

  const minute = Number(fields[0])
  const hour = Number(fields[1])
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return '09:00'
  }

  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export function dayOfWeekFromCron(cron: string): number {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5 || !/^\d+$/.test(fields[4])) {
    return 1
  }

  try {
    return normalizeDayOfWeek(Number(fields[4]))
  } catch {
    return 1
  }
}

export function validateFiveFieldCron(cron: string): { valid: boolean; error: string | null } {
  try {
    parseCron(cron)
    return { valid: true, error: null }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Schedules that fire more often than this can silently flood the board: a
// create-only schedule, or a create-and-start one whose Tasks finish before the
// next fire, spawns a fresh Task on every fire regardless of the de-dup guard.
export const MINIMUM_FIRE_INTERVAL_MS = 5 * 60_000

// Bounded horizon for sampling consecutive fires. A five-field cron repeats at
// most yearly, so scanning just over a year past `fromMs` reaches every distinct
// day-of-week / day-of-month / month cluster; the densest gap lives inside one.
const CADENCE_SAMPLE_HORIZON_MS = 400 * 24 * 60 * 60_000

export function validateCronCadence(cron: string, fromMs: number): { valid: boolean; error: string | null } {
  if (getMinFireIntervalMs(cron, fromMs) >= MINIMUM_FIRE_INTERVAL_MS) {
    return { valid: true, error: null }
  }
  return {
    valid: false,
    error: 'Task Schedules can fire at most once every 5 minutes. Choose a less frequent cadence.',
  }
}

// Smallest gap between two consecutive fires within the sampling horizon, or
// Infinity when fewer than two fires occur (e.g. yearly cadences). Walking fires
// consecutively keeps total work bounded by the horizon length in minutes,
// independent of how frequent the cron is.
function getMinFireIntervalMs(cron: string, fromMs: number): number {
  const limit = fromMs + CADENCE_SAMPLE_HORIZON_MS
  let cursor = fromMs
  let previous: number | null = null
  let min = Number.POSITIVE_INFINITY

  while (cursor <= limit) {
    let next: number
    try {
      next = getNextScheduledFireAt(cron, cursor)
    } catch {
      break
    }
    if (next > limit) break
    if (previous !== null) {
      min = Math.min(min, next - previous)
      // Once a sub-threshold gap is found the verdict cannot change; stop early
      // so pathologically frequent crons return without scanning the horizon.
      if (min < MINIMUM_FIRE_INTERVAL_MS) break
    }
    previous = next
    cursor = next
  }

  return min
}

export function getNextScheduledFireAt(cron: string, afterMs: number): number {
  const parsed = parseCron(cron)
  const cursor = new Date(afterMs)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  const maxIterations = 366 * 24 * 60 * 5
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (matchesCron(parsed, cursor)) {
      return cursor.getTime()
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  throw new Error('Unable to find next Scheduled Fire within five years')
}

export function describeCronExpression(cron: string): string {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true })
  } catch {
    return cron
  }
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(timeOfDay)
  if (!match) {
    throw new Error('Schedule time must use HH:MM format')
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Schedule time must be between 00:00 and 23:59')
  }

  return { hour, minute }
}

function normalizeDayOfWeek(dayOfWeek: number): number {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 7) {
    throw new Error('Weekly Schedule Preset day must be between 0 and 7')
  }
  return dayOfWeek === 7 ? 0 : dayOfWeek
}

function parseCron(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('Custom Schedule Preset must use five-field cron syntax')
  }

  return fields.map((field, index) => parseCronField(field, FIELD_LIMITS[index])) as ParsedCron
}

function parseCronField(field: string, limit: typeof FIELD_LIMITS[number]): CronField {
  if (!field || field.includes('?')) {
    throw new Error(`${limit.name} field is invalid`)
  }

  const values = new Set<number>()
  const wildcard = field === '*' || field.startsWith('*/')

  for (const part of field.split(',')) {
    addCronPart(values, part, limit)
  }

  return { wildcard, values }
}

function addCronPart(values: Set<number>, part: string, limit: typeof FIELD_LIMITS[number]): void {
  const [rangePart, rawStep] = part.split('/')
  if (part.split('/').length > 2 || rangePart === '') {
    throw new Error(`${limit.name} field has an invalid step`)
  }

  const step = rawStep === undefined ? 1 : parsePositiveInteger(rawStep, `${limit.name} step`)
  if (step <= 0) {
    throw new Error(`${limit.name} step must be greater than zero`)
  }

  const [start, end] = rangeBounds(rangePart, limit)
  for (let value = start; value <= end; value += step) {
    values.add(normalizeCronValue(value, limit))
  }
}

function rangeBounds(rangePart: string, limit: typeof FIELD_LIMITS[number]): [number, number] {
  if (rangePart === '*') return [limit.min, limit.max]

  if (rangePart.includes('-')) {
    const [rawStart, rawEnd] = rangePart.split('-')
    if (rangePart.split('-').length !== 2) {
      throw new Error(`${limit.name} field has an invalid range`)
    }
    const start = parseBoundedInteger(rawStart, limit)
    const end = parseBoundedInteger(rawEnd, limit)
    if (start > end) {
      throw new Error(`${limit.name} range start must not exceed end`)
    }
    return [start, end]
  }

  const value = parseBoundedInteger(rangePart, limit)
  return [value, value]
}

function parsePositiveInteger(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be a number`)
  }
  return Number(raw)
}

function parseBoundedInteger(raw: string, limit: typeof FIELD_LIMITS[number]): number {
  const value = parsePositiveInteger(raw, limit.name)
  if (value < limit.min || value > limit.max) {
    throw new Error(`${limit.name} field must be between ${limit.min} and ${limit.max}`)
  }
  return value
}

function normalizeCronValue(value: number, limit: typeof FIELD_LIMITS[number]): number {
  if (limit.name === 'day of week' && value === 7) return 0
  return value
}

function matchesCron(parsed: ParsedCron, date: Date): boolean {
  const checks = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ]

  return parsed.every((field, index) => field.values.has(checks[index]))
}
