import { terminalLogMessage } from './terminalLogging'
import type { TerminalTransport, TerminalTransportDisposable } from './terminalTransport'
import type { PoolEntry, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'

interface TerminalReconnectReplayOptions {
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  getEntries(): Iterable<PoolEntry>
  hasEntries(): boolean
  resetEntry(entry: PoolEntry): void
  notifyLifecycle(terminalKey: string): void
  recoverEntry?(entry: PoolEntry): Promise<void>
}

export function createTerminalReconnectReplay({
  transport,
  environment,
  getEntries,
  hasEntries,
  resetEntry,
  notifyLifecycle,
  recoverEntry,
}: TerminalReconnectReplayOptions) {
  let connectionRestoredSubscription: TerminalTransportDisposable | null = null
  let connectionRestoredSubscriptionPending: Promise<void> | null = null

  async function replayEntry(entry: PoolEntry): Promise<void> {
    if (entry.needsClear) return

    try {
      if (recoverEntry) {
        await recoverEntry(entry)
        notifyLifecycle(entry.shellSessionKey)
        if (entry.attached) entry.view.refresh()
        return
      }
      const replay = await transport.readReplay(entry.shellSessionKey)
      entry.ptyActive = replay.isLive
      if (!replay.data) {
        notifyLifecycle(entry.shellSessionKey)
        return
      }

      resetEntry(entry)
      entry.needsClear = false
      entry.outputSequence = 0
      entry.view.bootstrap(replay.data, replay.ptyInstanceId, entry.outputSequence)
      entry.hasOutput = true
      notifyLifecycle(entry.shellSessionKey)
      if (entry.attached) entry.view.refresh()
    } catch (error) {
      console.error(
        terminalLogMessage(environment.loggerName, 'Failed to replay PTY buffer after transport reconnect:'),
        error,
      )
    }
  }

  async function replayActiveTerminals(): Promise<void> {
    await Promise.all([...getEntries()].map(entry => replayEntry(entry)))
  }

  async function retainListener(): Promise<void> {
    if (connectionRestoredSubscription) return
    if (connectionRestoredSubscriptionPending) return connectionRestoredSubscriptionPending

    connectionRestoredSubscriptionPending = transport.subscribeConnectionRestored(() => {
      void replayActiveTerminals()
    })
      .then((subscription) => {
        if (!hasEntries()) {
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
    if (hasEntries()) return
    connectionRestoredSubscription?.dispose()
    connectionRestoredSubscription = null
  }

  function dispose(): void {
    connectionRestoredSubscription?.dispose()
    connectionRestoredSubscription = null
  }

  return {
    dispose,
    releaseListenerIfIdle,
    replayActiveTerminals,
    retainListener,
  }
}
