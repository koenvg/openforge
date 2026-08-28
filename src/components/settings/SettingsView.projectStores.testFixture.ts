import { vi } from 'vitest'

interface MockWritable<T> {
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(run: (value: T) => void): () => void
}

const stores = vi.hoisted(() => {
  function createMockWritable<T>(initialValue: T): MockWritable<T> {
    let value = initialValue
    const subscribers = new Set<(value: T) => void>()

    function notify() {
      subscribers.forEach((subscriber) => subscriber(value))
    }

    return {
      set(nextValue: T) {
        value = nextValue
        notify()
      },
      update(updater: (value: T) => T) {
        value = updater(value)
        notify()
      },
      subscribe(run: (value: T) => void) {
        run(value)
        subscribers.add(run)
        return () => subscribers.delete(run)
      },
    }
  }

  const defaultProject = {
    id: 'test-project-id',
    name: 'Test Project',
    path: '/tmp/test',
    created_at: Date.now(),
    updated_at: Date.now(),
  }

  return {
    activeProjectId: createMockWritable<string | null>('test-project-id'),
    error: createMockWritable<string | null>(null),
    defaultProject,
    projects: createMockWritable([defaultProject]),
  }
})

vi.mock('../../lib/stores', () => ({
  activeProjectId: stores.activeProjectId,
  projects: stores.projects,
  error: stores.error,
}))

export function resetSettingsViewProjectStores() {
  stores.activeProjectId.set('test-project-id')
  stores.error.set(null)
  stores.projects.set([{ ...stores.defaultProject }])
}
