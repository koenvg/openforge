import type { TerminalViewDisposable } from '../../src/terminalView'

type SubscribeToCapturedEvent<T> = (
  listener: (event: T) => void,
) => TerminalViewDisposable

export function createCapturedEventRecorder<T>(snapshotEvent: (event: T) => T) {
  let capturedEvents: T[] = []
  let subscription: TerminalViewDisposable | null = null

  return {
    subscribe(subscribe: SubscribeToCapturedEvent<T>, onCapture?: (event: T) => void) {
      subscription?.dispose()
      subscription = subscribe(event => {
        capturedEvents.push(event)
        onCapture?.(event)
      })
    },
    clear() {
      capturedEvents = []
    },
    reset() {
      subscription?.dispose()
      subscription = null
      capturedEvents = []
    },
    snapshot() {
      return capturedEvents.map(snapshotEvent)
    },
  }
}
