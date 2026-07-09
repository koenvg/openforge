import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { activeProjectId, attentionCountByProject, activeProjectAttentionCount, backlogLabelFilters } from './stores'

describe('activeProjectAttentionCount', () => {
  it("reports the active project's Focus attention count and reacts to store changes", () => {
    activeProjectId.set(null)
    attentionCountByProject.set(new Map())
    expect(get(activeProjectAttentionCount)).toBe(0)

    attentionCountByProject.set(new Map([['project-a', 4], ['project-b', 2]]))
    activeProjectId.set('project-a')
    expect(get(activeProjectAttentionCount)).toBe(4)

    activeProjectId.set('project-b')
    expect(get(activeProjectAttentionCount)).toBe(2)
  })

  it('reports zero when the active project has no attention entry', () => {
    attentionCountByProject.set(new Map([['project-a', 4]]))
    activeProjectId.set('project-without-tasks')
    expect(get(activeProjectAttentionCount)).toBe(0)
  })
})

describe('backlogLabelFilters', () => {
  it('keeps label filters during a project session and clears them when the active project changes', () => {
    activeProjectId.set(null)
    backlogLabelFilters.set(new Map())

    activeProjectId.set('project-a')
    backlogLabelFilters.set(new Map([['project-a', new Set([1, 2])]]))

    expect(get(backlogLabelFilters).get('project-a')).toEqual(new Set([1, 2]))

    activeProjectId.set('project-b')

    expect(get(backlogLabelFilters).size).toBe(0)
  })
})
