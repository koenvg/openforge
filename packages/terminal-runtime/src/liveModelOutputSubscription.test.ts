import { describe, expect, it, vi } from 'vitest'
import { createLiveModelOutputSubscriptionLifecycle } from './liveModelOutputSubscription'

describe('live model-output subscription lifecycle', () => {
  it('disposes a late registration while paused and registers again when re-enabled', async () => {
    let resolvePendingRegistration!: (registration: () => void) => void
    const lateDispose = vi.fn()
    const resumedDispose = vi.fn()
    const register = vi.fn()
      .mockImplementationOnce(() => new Promise<() => void>(resolve => {
        resolvePendingRegistration = resolve
      }))
      .mockImplementationOnce(() => resumedDispose)
    const lifecycle = createLiveModelOutputSubscriptionLifecycle({
      register,
      dispose: registration => registration(),
      disposedErrorMessage: 'disposed',
    })

    const enabling = lifecycle.setEnabled(true)
    const pausing = lifecycle.setEnabled(false)
    resolvePendingRegistration(lateDispose)

    await Promise.all([enabling, pausing])
    expect(lateDispose).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledOnce()

    await lifecycle.setEnabled(true)
    expect(register).toHaveBeenCalledTimes(2)
    expect(resumedDispose).not.toHaveBeenCalled()

    await lifecycle.setEnabled(false)
    expect(resumedDispose).toHaveBeenCalledOnce()
  })

  it('clears a rejected pending registration so enabling can retry', async () => {
    const retryDispose = vi.fn()
    const register = vi.fn()
      .mockRejectedValueOnce(new Error('registration failed'))
      .mockReturnValueOnce(retryDispose)
    const lifecycle = createLiveModelOutputSubscriptionLifecycle({
      register,
      dispose: registration => registration(),
      disposedErrorMessage: 'disposed',
    })

    await expect(lifecycle.setEnabled(true)).rejects.toThrow('registration failed')
    await expect(lifecycle.setEnabled(true)).resolves.toBeUndefined()
    expect(register).toHaveBeenCalledTimes(2)

    await lifecycle.setEnabled(false)
    expect(retryDispose).toHaveBeenCalledOnce()
  })

  it('excludes nullish registration handles from its type contract', () => {
    // @ts-expect-error Registration handles must be non-nullish.
    createLiveModelOutputSubscriptionLifecycle<null>({
      register: () => null,
      dispose: () => undefined,
      disposedErrorMessage: 'disposed',
    })
  })
})
