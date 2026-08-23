import { describe, expect, it } from 'vitest'
import { InsertRequestCoordinator } from './insertRequestCoordinator'

describe('InsertRequestCoordinator', () => {
  it('returns each new request once', () => {
    const coordinator = new InsertRequestCoordinator<{ id: number, text: string }>()
    const request = { id: 1, text: '/refactor ' }

    expect(coordinator.takeNewReadyRequest(request, true)).toBe(request)
    expect(coordinator.takeNewReadyRequest(request, true)).toBeNull()
    expect(coordinator.takeNewReadyRequest({ id: 2, text: '/review ' }, true)).toEqual({ id: 2, text: '/review ' })
  })

  it('leaves a request pending until the target is ready', () => {
    const coordinator = new InsertRequestCoordinator<{ id: number, marker: string }>()
    const request = { id: 3, marker: '[image#3]' }

    expect(coordinator.takeNewReadyRequest(request, false)).toBeNull()
    expect(coordinator.takeNewReadyRequest(request, true)).toBe(request)
  })

  it('ignores null and the initial request id', () => {
    const coordinator = new InsertRequestCoordinator<{ id: number, text: string }>()

    expect(coordinator.takeNewReadyRequest(null, true)).toBeNull()
    expect(coordinator.takeNewReadyRequest({ id: 0, text: 'old request' }, true)).toBeNull()
  })
})
