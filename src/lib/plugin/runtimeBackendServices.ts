import type { BackendMethodRegistration, BackendOpenForgeAPI, BackgroundServiceRegistration } from '@openforge-app/plugin-sdk/backend'
import type { Disposable } from '@openforge-app/plugin-sdk'
import {
  assertHandler,
  assertScope,
  createDisposable,
  isFunction,
  RuntimeValidationError,
  type RuntimeRegistryServices,
} from './runtimeContributionSupport'
import type {
  RuntimeBackendMethodContribution,
  RuntimeBackgroundServiceContribution,
} from './runtimeContributionTypes'

export class RuntimeBackendServices {
  private readonly backendMethods = new Map<string, RuntimeBackendMethodContribution>()
  private readonly backgroundServices = new Map<string, RuntimeBackgroundServiceContribution>()

  constructor(private readonly services: RuntimeRegistryServices) {}

  createApi(): Pick<BackendOpenForgeAPI, 'backend' | 'background'> {
    return {
      backend: {
        registerMethod: (method, registration) => this.registerBackendMethod(method, registration),
      },
      background: {
        register: (registration) => this.registerBackgroundService(registration),
      },
    }
  }

  getSnapshot(): {
    backendMethods: RuntimeBackendMethodContribution[]
    backgroundServices: RuntimeBackgroundServiceContribution[]
  } {
    return {
      backendMethods: Array.from(this.backendMethods.values()),
      backgroundServices: Array.from(this.backgroundServices.values()),
    }
  }

  captureBackgroundServiceIds(): Set<string> {
    return new Set(this.backgroundServices.keys())
  }

  async startNewBackgroundServices(previousKeys: Set<string>): Promise<void> {
    for (const [key, service] of this.backgroundServices.entries()) {
      if (previousKeys.has(key) || service.started) continue
      await service.start()
      service.started = true
    }
  }

  async invokeMethod<TOutput>(method: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.services.qualifiedId('backend', method)
    const contribution = this.backendMethods.get(qualifiedId)
    if (!contribution) {
      throw new Error(`Backend method is not registered: ${qualifiedId}`)
    }
    return await contribution.registration.handler(payload) as TOutput
  }

  private registerBackendMethod(method: string, registration: BackendMethodRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('backend', method)
    assertHandler('backend', registration?.handler)
    this.services.claims.claim('backend', qualifiedId)

    const contribution: RuntimeBackendMethodContribution = {
      id: method.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      registration,
    }
    this.backendMethods.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.backendMethods.delete(qualifiedId)
      this.services.claims.release('backend', qualifiedId)
    }))
  }

  private registerBackgroundService(registration: BackgroundServiceRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('background', registration?.id)
    assertScope(registration?.scope)
    if (!isFunction(registration?.start)) {
      throw new RuntimeValidationError('background', 'requires a start function')
    }
    this.services.claims.claim('background', qualifiedId)

    const contribution: RuntimeBackgroundServiceContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      started: false,
    }
    this.backgroundServices.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(async () => {
      this.backgroundServices.delete(qualifiedId)
      this.services.claims.release('background', qualifiedId)
      if (contribution.started) {
        await contribution.stop?.()
        contribution.started = false
      }
    }))
  }
}
