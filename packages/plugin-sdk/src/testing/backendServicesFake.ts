import type {
  BackendMethodRegistration,
  BackendOpenForgeAPI,
  BackgroundServiceRegistration,
  Disposable,
} from '../types'
import { assertFunction, createDisposable, type TestingRegistryServices } from './support.js'
import type {
  TestingBackendMethodContribution,
  TestingBackgroundServiceContribution,
} from './contracts'

export class TestingBackendServicesFake {
  private readonly backendMethods = new Map<string, TestingBackendMethodContribution>()
  private readonly backgroundServices = new Map<string, TestingBackgroundServiceContribution>()

  constructor(private readonly services: TestingRegistryServices) {}

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
    backendMethods: TestingBackendMethodContribution[]
    backgroundServices: TestingBackgroundServiceContribution[]
  } {
    return {
      backendMethods: Array.from(this.backendMethods.values()),
      backgroundServices: Array.from(this.backgroundServices.values()),
    }
  }

  captureBackgroundServiceIds(): Set<string> {
    return new Set(this.backgroundServices.keys())
  }

  async startNewBackgroundServices(existingServices: Set<string>): Promise<void> {
    for (const [key, service] of this.backgroundServices.entries()) {
      if (existingServices.has(key) || service.started) continue
      await service.start()
      service.started = true
    }
  }

  async invokeMethod<TOutput>(method: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.services.localQualifiedId('backend', method)
    this.services.calls.backendInvocations.push({ method, qualifiedId, payload })
    const contribution = this.backendMethods.get(qualifiedId)
    if (!contribution) {
      throw new Error(`Backend method is not registered: ${qualifiedId}`)
    }
    return await contribution.registration.handler(payload) as TOutput
  }

  private registerBackendMethod(method: string, registration: BackendMethodRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('backend', method)
    assertFunction('backend', 'handler', registration.handler)
    this.services.claims.claim('backend', qualifiedId)

    const contribution: TestingBackendMethodContribution = {
      id: method.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      registration,
    }
    this.backendMethods.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.backendMethods.delete(qualifiedId)
      this.services.claims.release('backend', qualifiedId)
    })
  }

  private registerBackgroundService(registration: BackgroundServiceRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('background', registration.id)
    if (registration.scope !== 'global' && registration.scope !== 'project' && registration.scope !== 'task') {
      throw new Error('background registration requires scope to be global, project, or task')
    }
    assertFunction('background', 'start', registration.start)
    this.services.claims.claim('background', qualifiedId)

    const contribution: TestingBackgroundServiceContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      started: false,
    }
    this.backgroundServices.set(qualifiedId, contribution)

    return createDisposable(async () => {
      this.backgroundServices.delete(qualifiedId)
      this.services.claims.release('background', qualifiedId)
      if (contribution.started) {
        await contribution.stop?.()
        contribution.started = false
      }
    })
  }
}
