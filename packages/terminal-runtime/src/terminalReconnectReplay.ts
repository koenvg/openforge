import { terminalLogMessage } from './terminalLogging'
import type {
  PoolEntry,
  TerminalRuntimeHost,
  TerminalRuntimeUnlistenFn,
} from './terminalRuntimeTypes'

export const APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

interface TerminalReconnectReplayOptions {
  host: TerminalRuntimeHost
  getEntries(): Iterable<PoolEntry>
  hasEntries(): boolean
  resetEntry(entry: PoolEntry): void
  notifyLifecycle(terminalKey: string): void
  recoverEntry?(entry: PoolEntry): Promise<void>
}

export function createTerminalReconnectReplay({
  host,
  getEntries,
  hasEntries,
  resetEntry,
  notifyLifecycle,
  recoverEntry,
}: TerminalReconnectReplayOptions) {
  let appEventsReconnectUnlisten: TerminalRuntimeUnlistenFn | null = null
  let appEventsReconnectListenerPending: Promise<void> | null = null

  async function replayEntry(entry: PoolEntry): Promise<void> {
    if (entry.needsClear) return

    try {
      if (recoverEntry) {
        await recoverEntry(entry)
        notifyLifecycle(entry.shellSessionKey)
        if (entry.attached) entry.view.refresh()
        return
      }
      const { buffer, isLive, instanceId } = await host.getPtyBuffer(entry.shellSessionKey)
      entry.ptyActive = isLive
      if (!buffer) {
        notifyLifecycle(entry.shellSessionKey)
        return
      }

      resetEntry(entry)
      entry.needsClear = false
      entry.view.bootstrap(buffer, instanceId)
      entry.hasOutput = true
      notifyLifecycle(entry.shellSessionKey)
      if (entry.attached) entry.view.refresh()
    } catch (error) {
      console.error(
        terminalLogMessage(host.loggerName, 'Failed to replay PTY buffer after app event reconnect:'),
        error,
      )
    }
  }

  async function replayActiveTerminals(): Promise<void> {
    await Promise.all([...getEntries()].map(entry => replayEntry(entry)))
  }

  async function retainListener(): Promise<void> {
    if (appEventsReconnectUnlisten) return
    if (appEventsReconnectListenerPending) return appEventsReconnectListenerPending

    appEventsReconnectListenerPending = host.listenEvent(APP_EVENTS_RECONNECTED_EVENT, () => {
      void replayActiveTerminals()
    })
      .then((unlisten) => {
        if (!hasEntries()) {
          unlisten()
          return
        }
        appEventsReconnectUnlisten = unlisten
      })
      .finally(() => {
        appEventsReconnectListenerPending = null
      })

    return appEventsReconnectListenerPending
  }

  function releaseListenerIfIdle(): void {
    if (hasEntries()) return
    appEventsReconnectUnlisten?.()
    appEventsReconnectUnlisten = null
  }

  return {
    releaseListenerIfIdle,
    replayActiveTerminals,
    retainListener,
  }
}
