import { terminalLogMessage } from './terminalLogging'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import type { TerminalRuntimeEnvironment } from './terminalRuntimeTypes'
import type { TerminalTransport, TerminalTransportDisposable } from './terminalTransport'

interface TerminalReconnectReplayOptions {
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  getCoordinators(): Iterable<TerminalSessionCoordinator>
  hasCoordinators(): boolean
}

export function createTerminalReconnectReplay({
  transport,
  environment,
  getCoordinators,
  hasCoordinators,
}: TerminalReconnectReplayOptions) {
  let connectionRestoredSubscription: TerminalTransportDisposable | null = null
  let connectionRestoredSubscriptionPending: Promise<void> | null = null

  async function replayCoordinator(coordinator: TerminalSessionCoordinator): Promise<void> {
    try {
      await coordinator.recoverAfterReconnect()
    } catch (error) {
      console.error(
        terminalLogMessage(environment.loggerName, 'Failed to restore terminal state after transport reconnect:'),
        error,
      )
    }
  }

  async function replayActiveTerminals(): Promise<void> {
    await Promise.all([...getCoordinators()].map(replayCoordinator))
  }

  async function retainListener(): Promise<void> {
    if (connectionRestoredSubscription) return
    if (connectionRestoredSubscriptionPending) return connectionRestoredSubscriptionPending

    connectionRestoredSubscriptionPending = transport.subscribeConnectionRestored(() => {
      void replayActiveTerminals()
    })
      .then((subscription) => {
        if (!hasCoordinators()) {
          subscription.dispose()
          return
        }
        connectionRestoredSubscription = subscription
      })
      .finally(() => {
        connectionRestoredSubscriptionPending = null
      })

    return connectionRestoredSubscriptionPending
  }

  function releaseListenerIfIdle(): void {
    if (hasCoordinators()) return
    connectionRestoredSubscription?.dispose()
    connectionRestoredSubscription = null
  }

  function dispose(): void {
    connectionRestoredSubscription?.dispose()
    connectionRestoredSubscription = null
  }

  return { dispose, releaseListenerIfIdle, replayActiveTerminals, retainListener }
}
