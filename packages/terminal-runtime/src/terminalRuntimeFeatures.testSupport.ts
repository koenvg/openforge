import { writable } from 'svelte/store'
import type { TerminalRuntimeEnvironment } from './terminalRuntime'
import type { ListenerRegistrationFailureSupport } from './terminalRuntimeHost.testSupport'
import {
  terminalMocks,
  xtermAddonMockState,
} from './terminalRuntimeXtermMocks.testSupport'

export { terminalMocks }

export const imageAddonMocks = {
  get failLoad() { return xtermAddonMockState.failImageAddon },
  set failLoad(value: boolean) { xtermAddonMockState.failImageAddon = value },
  get instances() { return xtermAddonMockState.imageAddonInstances },
}

export const webLinkMocks = {
  get callbacks() { return xtermAddonMockState.webLinkCallbacks },
}

export function resetTerminalRuntimeMocks(): void {
  terminalMocks.failCompatibilityAddon = false
  terminalMocks.instances.length = 0
  imageAddonMocks.failLoad = false
  imageAddonMocks.instances.length = 0
  webLinkMocks.callbacks.length = 0
}

export function createTrackedThemeMode() {
  const themeMode = writable<'light' | 'dark'>('dark')
  let subscriberCount = 0
  const store: NonNullable<TerminalRuntimeEnvironment['themeMode']> = {
    subscribe(run) {
      subscriberCount += 1
      const unsubscribe = themeMode.subscribe(run)
      return () => {
        unsubscribe()
        subscriberCount -= 1
      }
    },
  }

  return { store, getSubscriberCount: () => subscriberCount }
}

export function createListenerRegistrationFailureSupport(): ListenerRegistrationFailureSupport & {
  failNext(eventName: string): void
} {
  const failures = new Set<string>()

  return {
    failNext(eventName: string) {
      failures.add(eventName)
    },
    throwIfRequested(eventName: string) {
      if (failures.delete(eventName)) {
        throw new Error(`listener registration failed: ${eventName}`)
      }
    },
  }
}
