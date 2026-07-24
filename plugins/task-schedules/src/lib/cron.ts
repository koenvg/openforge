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

const GREGORIAN_CALENDAR_CYCLE_YEARS = 400
const NEXT_FIRE_SEARCH_HORIZON_MS = 5 * 366 * 24 * 60 * 60_000

type CalendarDate = readonly [year: number, month: number, date: number]
const timeZoneTransitionCache = new Map<string, CalendarDate[]>()

export function validateCronCadence(cron: string, fromMs: number): { valid: boolean; error: string | null } {
  if (getMinFireIntervalMs(cron, fromMs) >= MINIMUM_FIRE_INTERVAL_MS) {
    return { valid: true, error: null }
  }
  return {
    valid: false,
    error: 'Task Schedules can fire at most once every 5 minutes. Choose a less frequent cadence.',
  }
}

// Return a sentinel below the threshold when either nominal local-time gaps or
// timezone transitions can compress two fires below the minimum cadence.
function getMinFireIntervalMs(cron: string, fromMs: number): number {
  let parsed: ParsedCron
  try {
    parsed = parseCron(cron)
  } catch {
    return Number.POSITIVE_INFINITY
  }

  return hasSubMinimumWallClockInterval(parsed, fromMs)
    || hasSubMinimumDstInterval(parsed, fromMs)
    ? 0
    : Number.POSITIVE_INFINITY
}

function hasSubMinimumWallClockInterval(parsed: ParsedCron, fromMs: number): boolean {
  const minutesOfDay = scheduledMinutesOfDay(parsed)
  const minimumMinutes = MINIMUM_FIRE_INTERVAL_MS / 60_000

  const hasShortWithinDayGap = minutesOfDay.some((minuteOfDay, index) => (
    index > 0 && minuteOfDay - minutesOfDay[index - 1] < minimumMinutes
  ))
  if (hasShortWithinDayGap && hasMatchingCalendarDate(parsed, fromMs, false)) {
    return true
  }

  const overnightGap = 24 * 60 - minutesOfDay[minutesOfDay.length - 1] + minutesOfDay[0]
  return overnightGap < minimumMinutes && hasMatchingCalendarDate(parsed, fromMs, true)
}

function scheduledMinutesOfDay(parsed: ParsedCron): number[] {
  const minutes = [...parsed[0].values].sort((left, right) => left - right)
  const hours = [...parsed[1].values].sort((left, right) => left - right)
  return hours.flatMap((hour) => minutes.map((minute) => hour * 60 + minute))
}

function hasMatchingCalendarDate(parsed: ParsedCron, fromMs: number, requireConsecutive: boolean): boolean {
  const day = new Date(fromMs)
  day.setHours(12, 0, 0, 0)
  const finalDay = new Date(day)
  finalDay.setFullYear(finalDay.getFullYear() + GREGORIAN_CALENDAR_CYCLE_YEARS)
  finalDay.setDate(finalDay.getDate() + 1)

  let previousMatches = false
  while (day.getTime() <= finalDay.getTime()) {
    const matches = matchesCronDate(parsed, day)
    if (matches && (!requireConsecutive || previousMatches)) return true
    previousMatches = matches
    day.setDate(day.getDate() + 1)
  }
  return false
}

function hasSubMinimumDstInterval(parsed: ParsedCron, fromMs: number): boolean {
  const minutes = [...parsed[0].values].sort((left, right) => left - right)
  const hours = [...parsed[1].values].sort((left, right) => left - right)

  for (const [year, month, date] of timeZoneTransitionDates(fromMs)) {
    const day = new Date(year, month, date, 12, 0, 0, 0)
    const previousDay = new Date(day)
    previousDay.setDate(previousDay.getDate() - 1)
    const nextDay = new Date(day)
    nextDay.setDate(nextDay.getDate() + 1)

    const fires = scheduledFireTimesOnDay(parsed, day, hours, minutes)
    const previousFire = scheduledBoundaryFireTimeOnDay(parsed, previousDay, hours, minutes, false)
    const nextFire = scheduledBoundaryFireTimeOnDay(parsed, nextDay, hours, minutes, true)
    if (previousFire !== null) fires.unshift(previousFire)
    if (nextFire !== null) fires.push(nextFire)

    const futureFires = fires.filter((fireMs) => fireMs > fromMs)
    for (let index = 1; index < futureFires.length; index += 1) {
      if (futureFires[index] - futureFires[index - 1] < MINIMUM_FIRE_INTERVAL_MS) return true
    }
  }
  return false
}

function timeZoneTransitionDates(fromMs: number): CalendarDate[] {
  const day = new Date(fromMs)
  day.setHours(12, 0, 0, 0)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const cacheKey = `${timeZone}:${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
  const cached = timeZoneTransitionCache.get(cacheKey)
  if (cached) return cached

  const transitions: CalendarDate[] = []
  const finalDay = new Date(day)
  finalDay.setFullYear(finalDay.getFullYear() + GREGORIAN_CALENDAR_CYCLE_YEARS)
  while (day.getTime() < finalDay.getTime()) {
    if (isTimeZoneTransitionDay(day)) {
      transitions.push([day.getFullYear(), day.getMonth(), day.getDate()])
    }
    day.setDate(day.getDate() + 1)
  }

  timeZoneTransitionCache.set(cacheKey, transitions)
  return transitions
}

function isTimeZoneTransitionDay(day: Date): boolean {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const next = new Date(day)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next.getTime() - start.getTime() !== 24 * 60 * 60_000
}

function scheduledFireTimesOnDay(
  parsed: ParsedCron,
  day: Date,
  hours: number[],
  minutes: number[],
): number[] {
  if (!matchesCronDate(parsed, day)) return []

  const fires: number[] = []
  for (const hour of hours) {
    for (const minute of minutes) {
      const fireMs = scheduledFireTimeOnDay(day, hour, minute)
      if (fireMs !== null) fires.push(fireMs)
    }
  }
  return fires
}

function scheduledBoundaryFireTimeOnDay(
  parsed: ParsedCron,
  day: Date,
  hours: number[],
  minutes: number[],
  first: boolean,
): number | null {
  if (!matchesCronDate(parsed, day)) return null

  const orderedHours = first ? hours : [...hours].reverse()
  const orderedMinutes = first ? minutes : [...minutes].reverse()
  for (const hour of orderedHours) {
    for (const minute of orderedMinutes) {
      const fireMs = scheduledFireTimeOnDay(day, hour, minute)
      if (fireMs !== null) return fireMs
    }
  }
  return null
}

function scheduledFireTimeOnDay(day: Date, hour: number, minute: number): number | null {
  const candidate = new Date(day)
  candidate.setHours(hour, minute, 0, 0)

  // Spring-forward gaps normalize nonexistent local times forward. Only accept
  // candidates that retained the requested calendar fields.
  return candidate.getFullYear() === day.getFullYear()
    && candidate.getMonth() === day.getMonth()
    && candidate.getDate() === day.getDate()
    && candidate.getHours() === hour
    && candidate.getMinutes() === minute
    ? candidate.getTime()
    : null
}

export function getNextScheduledFireAt(cron: string, afterMs: number): number {
  const parsed = parseCron(cron)
  let next: number | null = null
  visitScheduledFires(parsed, afterMs, afterMs + NEXT_FIRE_SEARCH_HORIZON_MS, (current) => {
    next = current
    return true
  })

  if (next !== null) return next
  throw new Error('Unable to find next Scheduled Fire within five years')
}

// Visit only possible minute/hour combinations on matching calendar days. This
// keeps local-time and DST normalization in one iterator without walking every
// minute in the search horizon.
function visitScheduledFires(
  parsed: ParsedCron,
  afterMs: number,
  throughMs: number,
  onFire: (fireMs: number) => boolean,
): void {
  const minutes = [...parsed[0].values].sort((left, right) => left - right)
  const hours = [...parsed[1].values].sort((left, right) => left - right)
  const day = new Date(afterMs)
  day.setHours(12, 0, 0, 0)
  const finalDay = new Date(throughMs)
  finalDay.setHours(12, 0, 0, 0)

  while (day.getTime() <= finalDay.getTime()) {
    for (const fireMs of scheduledFireTimesOnDay(parsed, day, hours, minutes)) {
      if (fireMs <= afterMs) continue
      if (fireMs > throughMs) return
      if (onFire(fireMs)) return
    }
    day.setDate(day.getDate() + 1)
  }
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


function matchesCronDate(parsed: ParsedCron, date: Date): boolean {
  return parsed[2].values.has(date.getDate())
    && parsed[3].values.has(date.getMonth() + 1)
    && parsed[4].values.has(date.getDay())
}
