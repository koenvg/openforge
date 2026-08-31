import type {
  AppDesktopEventName,
  AppDesktopEventPayloads,
  KnownDesktopEventName,
  KnownDesktopEventPayload,
  TerminalDesktopEventName,
  TerminalDesktopEventPayload,
} from './desktopIpcContract'

export type DesktopUnlistenFn = () => void

export interface DesktopEvent<T> {
  event: string
  payload: T
}

export interface OpenForgeDesktopBridge {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): DesktopUnlistenFn
  onEventReady?(eventName: string, handler: (payload: unknown) => void): Promise<DesktopUnlistenFn>
}

declare global {
  interface Window {
    openforge?: OpenForgeDesktopBridge
  }
}

function electronBridge(): OpenForgeDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.openforge ?? null
}

function requireElectronBridge(): OpenForgeDesktopBridge {
  const bridge = electronBridge()
  if (!bridge) {
    throw new Error('Open Forge desktop bridge is unavailable; run the app in the Electron shell')
  }
  return bridge
}

export function isElectronDesktopBridgeAvailable(): boolean {
  return electronBridge() !== null
}

export async function invokeDesktopCommand<T>(command: string): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload: unknown): Promise<T>
export async function invokeDesktopCommand<T>(command: string, payload?: unknown): Promise<T> {
  return requireElectronBridge().invoke(command, payload ?? null) as Promise<T>
}

async function listenRawDesktopEvent<TPayload>(
  eventName: string,
  handler: (event: DesktopEvent<TPayload>) => void | Promise<void>,
  awaitRegistration = false,
): Promise<DesktopUnlistenFn> {
  const bridge = requireElectronBridge()
  const onPayload = (payload: unknown) => {
    void handler({ event: eventName, payload: payload as TPayload })
  }
  const unsubscribe = awaitRegistration && bridge.onEventReady
    ? await bridge.onEventReady(eventName, onPayload)
    : bridge.onEvent(eventName, onPayload)

  return () => unsubscribe()
}

export function listenDesktopEvent<TEventName extends AppDesktopEventName>(
  eventName: TEventName,
  handler: (event: DesktopEvent<AppDesktopEventPayloads[TEventName]>) => void | Promise<void>,
): Promise<DesktopUnlistenFn>
export function listenDesktopEvent<TEventName extends TerminalDesktopEventName>(
  eventName: TEventName,
  handler: (event: DesktopEvent<TerminalDesktopEventPayload<TEventName>>) => void | Promise<void>,
): Promise<DesktopUnlistenFn>
export function listenDesktopEvent<TEventName extends KnownDesktopEventName>(
  eventName: TEventName,
  handler: (event: DesktopEvent<KnownDesktopEventPayload<TEventName>>) => void | Promise<void>,
): Promise<DesktopUnlistenFn>
export function listenDesktopEvent(
  eventName: KnownDesktopEventName,
  handler: (event: DesktopEvent<never>) => void | Promise<void>,
): Promise<DesktopUnlistenFn> {
  return listenRawDesktopEvent(eventName, handler, true)
}

export function listenPluginDesktopEvent(
  eventName: string,
  handler: (event: DesktopEvent<unknown>) => void | Promise<void>,
): Promise<DesktopUnlistenFn> {
  return listenRawDesktopEvent(eventName, handler)
}

export {}
