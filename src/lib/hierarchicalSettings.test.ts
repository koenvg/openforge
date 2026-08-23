import { describe, it, expect } from 'vitest'
import {
  HIERARCHICAL_SETTINGS,
  computeEffectiveProjectSettings,
  isSettingVisible,
} from './hierarchicalSettings'

describe('hierarchical settings registry', () => {
  it('marks task-applicable settings correctly', () => {
    const byKey = Object.fromEntries(HIERARCHICAL_SETTINGS.map((s) => [s.key, s]))
    expect(byKey['code_cleanup_tasks_enabled'].levels).toContain('task')
    expect(byKey['ai_provider'].levels).toContain('task')
    // Project-only settings do not cascade to tasks.
    expect(byKey['task_id_prefix'].levels).not.toContain('task')
    expect(byKey['github_poll_interval'].levels).not.toContain('task')
  })

  it('project raw override wins over global, absence inherits global', () => {
    const global = { code_cleanup_tasks_enabled: 'false', ai_provider: 'claude-code' }
    const projectRaw = { code_cleanup_tasks_enabled: 'true' } // ai_provider absent
    const eff = computeEffectiveProjectSettings(global, projectRaw)
    expect(eff.code_cleanup_tasks_enabled).toBe('true')
    expect(eff.ai_provider).toBe('claude-code')
  })

  it('project effective merges raw overrides over globals', () => {
    const eff = computeEffectiveProjectSettings(
      { use_worktrees: 'true', task_id_prefix: 'T' },
      { use_worktrees: 'false' }, // task_id_prefix absent -> inherits 'T'
    )
    expect(eff.use_worktrees).toBe('false')
    expect(eff.task_id_prefix).toBe('T')
  })
})

describe('isSettingVisible', () => {
  const destination = HIERARCHICAL_SETTINGS.find((s) => s.key === 'code_cleanup_destination')!

  it('registers a code_cleanup_destination select with openforge + github_issues options', () => {
    expect(destination).toBeDefined()
    expect(destination.control).toBe('select')
    expect(destination.default).toBe('openforge')
    expect(destination.options?.map((o) => o.value)).toEqual(['openforge', 'github_issues'])
    expect(destination.levels).toEqual(['global', 'project'])
  })

  it('hides the destination when cleanup is off', () => {
    expect(isSettingVisible(destination, { code_cleanup_tasks_enabled: 'false' })).toBe(false)
  })

  it('shows the destination when cleanup is on', () => {
    expect(isSettingVisible(destination, { code_cleanup_tasks_enabled: 'true' })).toBe(true)
  })

  it('always shows a setting without showWhen', () => {
    const toggle = HIERARCHICAL_SETTINGS.find((s) => s.key === 'code_cleanup_tasks_enabled')!
    expect(toggle).toBeDefined()
    expect(isSettingVisible(toggle, {})).toBe(true)
  })
})
