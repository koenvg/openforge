export interface StoryEnvironmentAdapter {
  install(): void | Promise<void>
  reset(): void | Promise<void>
  dispose(): void | Promise<void>
}

export interface StoryEnvironmentDefinition {
  id: string
  now: number | string
  adapters?: readonly StoryEnvironmentAdapter[]
}

export interface StoryEnvironment {
  readonly scenarioId: string
  install(): Promise<void>
  reset(): Promise<void>
  dispose(): Promise<void>
}

export function createStoryEnvironment(definition: StoryEnvironmentDefinition): StoryEnvironment {
  if (!definition.id.trim()) throw new Error('Story scenario id must be non-empty')
  const scenarioTime = typeof definition.now === 'number' ? definition.now : Date.parse(definition.now)
  if (!Number.isFinite(scenarioTime)) throw new Error('Story scenario time must be finite')
  const adapters = [...(definition.adapters ?? [])]
  let hostDate = Date
  let installed = false
  let disposed = false
  let installation: Promise<void> | undefined
  let disposal: Promise<void> | undefined

  function installClock(): void {
    const FixedDate = class extends hostDate {
      static now(): number { return scenarioTime }
    }
    // The proxy implements Date's callable overload as well as its constructor.
    globalThis.Date = new Proxy(FixedDate, {
      construct(_target, args, newTarget) {
        return Reflect.construct(hostDate, args.length ? args : [scenarioTime], newTarget)
      },
      apply() { return new hostDate(scenarioTime).toString() },
    }) as unknown as DateConstructor
  }

  async function release(items: readonly StoryEnvironmentAdapter[]): Promise<void> {
    const errors: unknown[] = []
    for (const adapter of [...items].reverse()) {
      try { await adapter.dispose() } catch (error) { errors.push(error) }
    }
    globalThis.Date = hostDate
    installed = false
    if (errors.length) throw new AggregateError(errors, 'Story environment teardown failed')
  }

  async function install(): Promise<void> {
    if (disposed) throw new Error('Disposed story environment cannot be installed')
    installation ??= Promise.resolve().then(installAdapters)
    await installation
  }

  async function installAdapters(): Promise<void> {
    hostDate = Date
    installClock()
    const acquired: StoryEnvironmentAdapter[] = []
    try {
      for (const adapter of adapters) {
        // Even a partially installed adapter must release its resources on failure.
        acquired.push(adapter)
        await adapter.install()
      }
      installed = true
    } catch (error) {
      disposed = true
      try { await release(acquired) } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Story environment installation failed')
      }
      throw error
    }
  }

  async function reset(): Promise<void> {
    if (!installed || disposed) throw new Error('Story environment must be installed before reset')
    installClock()
    for (const adapter of adapters) await adapter.reset()
  }

  function dispose(): Promise<void> {
    if (disposal) return disposal
    disposed = true
    disposal = (async () => {
      // Failed installation already rolls back the acquired adapters.
      await installation?.catch(() => undefined)
      if (installed) await release(adapters)
    })()
    return disposal
  }

  return Object.freeze({ scenarioId: definition.id, install, reset, dispose })
}
