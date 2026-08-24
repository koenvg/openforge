import { vi } from 'vitest'
import type { AgentSession } from '../../lib/types'

interface MockWritable<T> {
  set(value: T): void
  update(updater: (value: T) => T): void
  subscribe(run: (value: T) => void): () => void
}

const { activeSessions } = vi.hoisted(() => {
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
        return () => {
          subscribers.delete(run)
        }
      },
    }
  }

  return {
    activeSessions: createMockWritable<Map<string, AgentSession>>(new Map()),
  }
})

vi.mock('../../lib/stores', () => ({ activeSessions }))

export function resetActiveSessions() {
  activeSessions.set(new Map())
}

export function setActiveSession(session: AgentSession) {
  activeSessions.set(new Map([[session.ticket_id, session]]))
}
