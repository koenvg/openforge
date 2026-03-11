import type { CreatureState } from './creatureState'
import type { BoardColumnConfig, KanbanColumn } from './types'
import { getProjectConfig, setProjectConfig } from './ipc'

const BOARD_COLUMNS_CONFIG_KEY = 'board_columns'

export const ALL_CREATURE_STATES: CreatureState[] = [
  'egg',
  'idle',
  'active',
  'needs-input',
  'resting',
  'celebrating',
  'sad',
  'frozen',
  'done',
  'pr-draft',
  'pr-open',
  'ci-failed',
  'changes-requested',
  'ready-to-merge',
  'pr-merged',
]

export const CREATURE_STATE_LABELS: Record<CreatureState, string> = {
  egg: 'Egg',
  idle: 'Idle',
  active: 'Active',
  'needs-input': 'Needs Input',
  resting: 'Resting',
  celebrating: 'Celebrating',
  sad: 'Sad',
  frozen: 'Frozen',
  done: 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Requested',
  'ready-to-merge': 'Ready to Merge',
  'pr-merged': 'PR Merged',
}

export const DEFAULT_BOARD_COLUMNS: BoardColumnConfig[] = [
  {
    id: 'col-backlog',
    name: 'Backlog',
    statuses: ['egg'],
    underlyingStatus: 'backlog',
  },
  {
    id: 'col-doing',
    name: 'Doing',
    statuses: [
      'idle',
      'active',
      'needs-input',
      'resting',
      'celebrating',
      'sad',
      'frozen',
      'pr-draft',
      'pr-open',
      'ci-failed',
      'changes-requested',
      'ready-to-merge',
      'pr-merged',
    ],
    underlyingStatus: 'doing',
  },
  {
    id: 'col-done',
    name: 'Done',
    statuses: ['done'],
    underlyingStatus: 'done',
  },
]

export function validateBoardColumns(columns: BoardColumnConfig[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!Array.isArray(columns) || columns.length === 0) {
    errors.push('At least one board column is required.')
    return { valid: false, errors }
  }

  const allowedUnderlyingStatuses: KanbanColumn[] = ['backlog', 'doing', 'done']
  const stateCounts = new Map<CreatureState, number>()

  for (const column of columns) {
    if (typeof column.name !== 'string' || column.name.trim().length === 0) {
      errors.push(`Column "${column.id}" must have a non-empty name.`)
    }

    if (!allowedUnderlyingStatuses.includes(column.underlyingStatus)) {
      errors.push(`Column "${column.id}" has invalid underlyingStatus: ${String(column.underlyingStatus)}.`)
    }

    for (const state of column.statuses) {
      if (!ALL_CREATURE_STATES.includes(state)) {
        errors.push(`Unknown creature state: ${String(state)}.`)
        continue
      }

      stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1)
    }
  }

  for (const state of ALL_CREATURE_STATES) {
    const count = stateCounts.get(state) ?? 0
    if (count === 0) {
      errors.push(`Creature state "${state}" is missing from all columns.`)
    } else if (count > 1) {
      errors.push(`Creature state "${state}" appears in multiple columns.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function getColumnForCreatureState(state: CreatureState, columns: BoardColumnConfig[]): BoardColumnConfig {
  const match = columns.find((column) => column.statuses.includes(state))
  return match ?? columns[0] ?? DEFAULT_BOARD_COLUMNS[0]
}

export async function loadBoardColumns(projectId: string): Promise<BoardColumnConfig[]> {
  const stored = await getProjectConfig(projectId, BOARD_COLUMNS_CONFIG_KEY)

  if (!stored) {
    await saveBoardColumns(projectId, DEFAULT_BOARD_COLUMNS)
    return DEFAULT_BOARD_COLUMNS
  }

  try {
    const parsed = JSON.parse(stored)

    if (Array.isArray(parsed)) {
      const validation = validateBoardColumns(parsed as BoardColumnConfig[])
      if (validation.valid) {
        return parsed as BoardColumnConfig[]
      }
    }
  } catch {
  }

  await saveBoardColumns(projectId, DEFAULT_BOARD_COLUMNS)
  return DEFAULT_BOARD_COLUMNS
}

export async function saveBoardColumns(projectId: string, columns: BoardColumnConfig[]): Promise<void> {
  await setProjectConfig(projectId, BOARD_COLUMNS_CONFIG_KEY, JSON.stringify(columns))
}
