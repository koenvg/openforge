import { expect, it } from 'vitest'
import { get } from 'svelte/store'
import { activeProjectId } from '../../../src/lib/stores'
import { activeTasks, clearActiveTasks, installActiveTasks } from '../../../src/lib/tasksState'
import { createTask } from '../fixtures/appFixtures'
import { createStoryTaskAdapter } from './storyTaskAdapter'

it('restores host tasks after a story and resets edited fixture tasks', () => {
  const previousProject = get(activeProjectId)
  const original = createTask({ id: 'original', projectId: 'host' })
  activeProjectId.set('host')
  installActiveTasks('host', { tasks: [original], related: [] })
  const adapter = createStoryTaskAdapter('story', { tasks: [createTask({ id: 'fixture' })], related: [] })
  try {
    adapter.install()
    expect(get(activeTasks).map(task => task.id)).toEqual(['fixture'])
    installActiveTasks('story', { tasks: [], related: [] })
    adapter.reset()
    expect(get(activeTasks).map(task => task.id)).toEqual(['fixture'])
    adapter.dispose()
    expect(get(activeTasks)).toEqual([original])
  } finally {
    clearActiveTasks()
    activeProjectId.set(previousProject)
  }
})
