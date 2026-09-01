import { isValidTerminalDimensions } from './terminalGeometry'
import type { TerminalImageProtocol } from './terminalImages'
import { terminalLogMessage } from './terminalLogging'
import type { ShellLifecycleState, TerminalRuntimeEnvironment } from './terminalRuntimeTypes'
import type {
  TerminalGeometry,
  TerminalModelDisabledEvent,
  TerminalReplay,
  TerminalTransport,
} from './terminalTransport'
import type { TerminalView } from './terminalView'

interface TerminalPtyCoordinatorOptions {
  shellSessionKey: string
  view: TerminalView
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  notify(state: ShellLifecycleState): void
}

export interface TerminalPtySpawnRequest {
  readonly generation: number
  readonly geometry: TerminalGeometry
  readonly imageProtocol: TerminalImageProtocol | null
}

export interface TerminalPtyCoordinator {
  getLifecycleState(): ShellLifecycleState
  isActive(): boolean
  isExited(): boolean
  isSpawnPending(): boolean
  needsReconnectRecovery(): boolean
  getCurrentInstance(): number | null
  applyReplayState(replay: TerminalReplay, hasOutput: boolean): void
  markOutput(): void
  handleModelDisabled(event: TerminalModelDisabledEvent): void
  handleExit(ptyInstanceId: number): void
  beginSpawn(): TerminalPtySpawnRequest | null
  startSpawn(generation: number, instanceId: number): boolean
  cancelSpawn(generation: number): void
  restoreInstance(instanceId: number): boolean
  shouldApplyPendingRestoredInstance(): boolean
  syncSize(viewActive: boolean, dimensions?: TerminalGeometry | null): void
}

export function createTerminalPtyCoordinator({
  shellSessionKey,
  view,
  transport,
  environment,
  notify,
}: TerminalPtyCoordinatorOptions): TerminalPtyCoordinator {
  let ptyActive = false
  let needsClear = false
  let shellExited = false
  let spawnGeneration = 0
  let activeSpawnGeneration: number | null = null
  let currentPtyInstance: number | null = null
  let hasOutput = false

  function lifecycleState(): ShellLifecycleState {
    return { ptyActive, shellExited, currentPtyInstance, hasOutput }
  }

  function setCurrentPtyInstance(instanceId: number | null): void {
    currentPtyInstance = instanceId
  }

  function selectPtyInstance(instanceId: number): void {
    setCurrentPtyInstance(instanceId)
    activeSpawnGeneration = null
    ptyActive = true
    shellExited = false
    needsClear = false
    notify(lifecycleState())
  }

  function applyReplayState(replay: TerminalReplay, replayHasOutput: boolean): void {
    if (replay.ptyInstanceId === null) {
      ptyActive = false
      shellExited = false
      needsClear = false
      setCurrentPtyInstance(null)
      hasOutput = replayHasOutput
      return
    }

    ptyActive = replay.isLive
    shellExited = !replay.isLive
    needsClear = false
    setCurrentPtyInstance(replay.ptyInstanceId)
    hasOutput = replayHasOutput
  }

  function markOutput(): void {
    ptyActive = true
    shellExited = false
    hasOutput = true
    notify(lifecycleState())
  }

  function handleModelDisabled(event: TerminalModelDisabledEvent): void {
    if (currentPtyInstance !== event.ptyInstanceId) return
    ptyActive = false
    notify(lifecycleState())
  }

  function handleExit(ptyInstanceId: number): void {
    if (currentPtyInstance !== null && ptyInstanceId !== currentPtyInstance) return
    ptyActive = false
    shellExited = true
    needsClear = true
    notify(lifecycleState())
  }

  function syncSize(viewActive: boolean, dimensions: TerminalGeometry | null = view.geometry): void {
    if (!ptyActive || !viewActive) return
    if (!isValidTerminalDimensions(dimensions)) return
    transport.resize(shellSessionKey, dimensions)
      .catch(error => console.error(terminalLogMessage(environment.loggerName, 'resize failed:'), error))
  }

  function beginSpawn(): TerminalPtySpawnRequest | null {
    if (ptyActive || activeSpawnGeneration !== null) return null
    const geometry = view.geometry
    if (!isValidTerminalDimensions(geometry)) return null

    spawnGeneration += 1
    const generation = spawnGeneration
    activeSpawnGeneration = generation
    hasOutput = false
    notify(lifecycleState())

    return Object.freeze({
      generation,
      geometry: { ...geometry },
      imageProtocol: view.imageProtocol,
    })
  }

  function startSpawn(generation: number, instanceId: number): boolean {
    if (activeSpawnGeneration !== generation) return false
    selectPtyInstance(instanceId)
    return true
  }

  function cancelSpawn(generation: number): void {
    if (activeSpawnGeneration !== generation) return
    activeSpawnGeneration = null
    notify(lifecycleState())
  }

  function restoreInstance(instanceId: number): boolean {
    const shouldRecover = !ptyActive || currentPtyInstance !== instanceId
    selectPtyInstance(instanceId)
    return shouldRecover
  }

  return {
    getLifecycleState: lifecycleState,
    isActive: () => ptyActive,
    isExited: () => shellExited,
    isSpawnPending: () => activeSpawnGeneration !== null,
    needsReconnectRecovery: () => !needsClear,
    getCurrentInstance: () => currentPtyInstance,
    applyReplayState,
    markOutput,
    handleModelDisabled,
    handleExit,
    beginSpawn,
    startSpawn,
    cancelSpawn,
    restoreInstance,
    shouldApplyPendingRestoredInstance: () => !ptyActive || currentPtyInstance === null,
    syncSize,
  }
}
