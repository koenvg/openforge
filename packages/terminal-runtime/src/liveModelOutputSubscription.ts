export interface LiveModelOutputSubscriptionLifecycle {
  setEnabled(enabled: boolean): Promise<void>
  snapshot(): LiveModelOutputSubscriptionSnapshot
  dispose(): void
}

export interface LiveModelOutputSubscriptionSnapshot {
  desired: boolean
  pending: boolean
  registered: boolean
  disposed: boolean
}

export interface LiveModelOutputSubscriptionLifecycleOptions<TRegistration extends object> {
  register(): TRegistration | PromiseLike<TRegistration>
  dispose(registration: TRegistration): void
  disposedErrorMessage: string
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>).then === 'function'
}

export function createLiveModelOutputSubscriptionLifecycle<TRegistration extends object>(
  options: LiveModelOutputSubscriptionLifecycleOptions<TRegistration>,
): LiveModelOutputSubscriptionLifecycle {
  let active = true
  let desired = false
  let currentRegistration: TRegistration | null = null
  let pendingRegistration: Promise<void> | null = null

  function finishRegistration(registration: TRegistration): void {
    if (!active || !desired) {
      options.dispose(registration)
      return
    }
    currentRegistration = registration
  }

  return {
    snapshot() {
      return {
        desired,
        pending: pendingRegistration !== null,
        registered: currentRegistration !== null,
        disposed: !active,
      }
    },
    async setEnabled(enabled) {
      if (!active) throw new Error(options.disposedErrorMessage)
      desired = enabled

      if (!enabled) {
        if (currentRegistration !== null) options.dispose(currentRegistration)
        currentRegistration = null
        await pendingRegistration
        return
      }

      if (currentRegistration !== null) return
      if (pendingRegistration) return pendingRegistration

      const registration = options.register()
      if (!isPromiseLike(registration)) {
        finishRegistration(registration)
        return
      }

      const pending = Promise.resolve(registration).then(finishRegistration)
      pendingRegistration = pending
      try {
        await pending
      } finally {
        if (pendingRegistration === pending) pendingRegistration = null
      }
    },

    dispose() {
      if (!active) return
      active = false
      desired = false
      if (currentRegistration !== null) options.dispose(currentRegistration)
      currentRegistration = null
    },
  }
}
