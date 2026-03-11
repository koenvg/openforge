import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardColumnConfig } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

import {
  ALL_TASK_STATES,
  TASK_STATE_LABELS,
  DEFAULT_BOARD_COLUMNS,
  getColumnForTaskState,
  loadBoardColumns,
  saveBoardColumns,
  validateBoardColumns,
} from '../lib/boardColumns'
import { getProjectConfig, setProjectConfig } from '../lib/ipc'

describe('boardColumns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constants', () => {
    it('defines all 15 task states', () => {
      expect(ALL_TASK_STATES).toHaveLength(15)
      expect(ALL_TASK_STATES).toEqual([
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
      ])
    })

    it('maps task state labels to human readable names', () => {
      expect(TASK_STATE_LABELS['egg']).toBe('Egg')
      expect(TASK_STATE_LABELS['needs-input']).toBe('Needs Input')
      expect(TASK_STATE_LABELS['pr-draft']).toBe('PR Draft')
      expect(TASK_STATE_LABELS['ci-failed']).toBe('CI Failed')
      expect(TASK_STATE_LABELS['ready-to-merge']).toBe('Ready to Merge')
    })

    it('defines default columns matching current behavior', () => {
      expect(DEFAULT_BOARD_COLUMNS).toHaveLength(3)
      expect(DEFAULT_BOARD_COLUMNS).toEqual([
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
      ])
    })
  })

  describe('validateBoardColumns', () => {
    it('returns valid for defaults', () => {
      expect(validateBoardColumns(DEFAULT_BOARD_COLUMNS)).toEqual({
        valid: true,
        errors: [],
      })
    })

    it('requires at least one column', () => {
      const result = validateBoardColumns([])
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('fails when a state is missing', () => {
      const withoutDone: BoardColumnConfig[] = DEFAULT_BOARD_COLUMNS.map((column) => {
        if (column.id !== 'col-done') return column
        return { ...column, statuses: [] }
      })

      const result = validateBoardColumns(withoutDone)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('done'))).toBe(true)
    })

    it('fails when a state appears in multiple columns', () => {
      const withDuplicate: BoardColumnConfig[] = [
        ...DEFAULT_BOARD_COLUMNS,
      ].map((column) => {
        if (column.id !== 'col-backlog') return column
        return { ...column, statuses: ['egg', 'idle'] }
      })

      const result = validateBoardColumns(withDuplicate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('idle'))).toBe(true)
    })

    it('fails when a column name is empty', () => {
      const invalidColumns: BoardColumnConfig[] = [
        { ...DEFAULT_BOARD_COLUMNS[0], name: ' ' },
        ...DEFAULT_BOARD_COLUMNS.slice(1),
      ]

      const result = validateBoardColumns(invalidColumns)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('name'))).toBe(true)
    })

    it('fails when underlyingStatus is invalid', () => {
      const invalidColumns = [
        { ...DEFAULT_BOARD_COLUMNS[0], underlyingStatus: 'wip' },
        ...DEFAULT_BOARD_COLUMNS.slice(1),
      ] as unknown as BoardColumnConfig[]

      const result = validateBoardColumns(invalidColumns)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes('underlyingStatus'))).toBe(true)
    })
  })

  describe('getColumnForTaskState', () => {
    it('returns matching column for task state', () => {
      const column = getColumnForTaskState('pr-open', DEFAULT_BOARD_COLUMNS)
      expect(column.id).toBe('col-doing')
    })

    it('falls back to first column when state not found', () => {
      const customColumns: BoardColumnConfig[] = [
        {
          id: 'first',
          name: 'First',
          statuses: ['egg'],
          underlyingStatus: 'backlog',
        },
      ]

      const column = getColumnForTaskState('done', customColumns)
      expect(column.id).toBe('first')
    })
  })

  describe('loadBoardColumns', () => {
    it('returns defaults and seeds config when missing', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue(null)

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('returns stored config when valid', async () => {
      const customColumns: BoardColumnConfig[] = [
        {
          id: 'col-backlog',
          name: 'Queue',
          statuses: ['egg', 'idle'],
          underlyingStatus: 'backlog',
        },
        {
          id: 'col-doing',
          name: 'In Progress',
          statuses: [
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

      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(customColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(customColumns)
      expect(setProjectConfig).not.toHaveBeenCalled()
    })

    it('falls back to defaults when JSON is malformed', async () => {
      vi.mocked(getProjectConfig).mockResolvedValue('{bad json')

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })

    it('falls back to defaults when stored config is invalid', async () => {
      const invalidColumns = [
        {
          id: 'col-backlog',
          name: 'Backlog',
          statuses: ['egg'],
          underlyingStatus: 'backlog',
        },
      ]
      vi.mocked(getProjectConfig).mockResolvedValue(JSON.stringify(invalidColumns))

      const result = await loadBoardColumns('project-1')

      expect(result).toEqual(DEFAULT_BOARD_COLUMNS)
      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })
  })

  describe('saveBoardColumns', () => {
    it('serializes columns to project_config', async () => {
      await saveBoardColumns('project-1', DEFAULT_BOARD_COLUMNS)

      expect(setProjectConfig).toHaveBeenCalledWith(
        'project-1',
        'board_columns',
        JSON.stringify(DEFAULT_BOARD_COLUMNS),
      )
    })
  })
})
