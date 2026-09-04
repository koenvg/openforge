import { createCapturedEventRecorder } from './capturedEventRecorder'
import { getTerminalConformanceRenderer } from './rendererRegistry'
import { getPresentationRecordings, terminalModelRecordingCorpus } from '../../src/terminalPresentationCorpus'
import { preloadTerminalFonts } from '../../src/terminalOptions'
import { getTerminalTheme, type ThemeMode } from '../../src/theme'
import type {
  TerminalView,
  TerminalViewPresentationEvidence,
  TerminalViewPresentationSnapshot,
  TerminalViewRendererFailure,
} from '../../src/terminalView'
import './style.css'

type SurfaceKind = 'agent' | 'plugin-shell'

interface ResetOptions {
  surface: SurfaceKind
  theme: ThemeMode
  width?: number
  height?: number
  echoInput?: boolean
}

interface PlayResult {
  evidence: TerminalViewPresentationEvidence
  presentation: TerminalViewPresentationSnapshot
}

interface RendererFailureRecord {
  terminalKey: string
  renderer: string
  reason: TerminalViewRendererFailure['reason']
}

interface ConcurrentLifecycleResult extends PlayResult {
  rendererFailures: RendererFailureRecord[]
  secondaryEvidence: TerminalViewPresentationEvidence
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Terminal conformance element is missing: ${selector}`)
  return element
}

const main = requiredElement('main')
const host = requiredElement('#terminal-host')
const surfaceLabel = requiredElement('#surface-kind')
const rendererLabel = requiredElement('#renderer-kind')
const renderer = getTerminalConformanceRenderer(new URLSearchParams(location.search).get('renderer') ?? 'xterm')
rendererLabel.textContent = renderer.id

const ptyInstanceId = 1
let outputSequence = 0
let view: TerminalView | null = null
const inputRecorder = createCapturedEventRecorder<string>(event => event)
let openedLinks: string[] = []
let echoInput = false
let inputPresentation = Promise.resolve<TerminalViewPresentationEvidence | null>(null)
let currentTheme: ThemeMode = 'dark'
let concurrentHost: HTMLElement | null = null
let concurrentView: TerminalView | null = null
let concurrentSequence = 0
let rendererFailures: RendererFailureRecord[] = []

function requireView(): TerminalView {
  if (!view) throw new Error('Terminal conformance view has not been reset')
  return view
}

function recordingById(id: string) {
  const recording = terminalModelRecordingCorpus.recordings.find(candidate => candidate.id === id)
  if (!recording) throw new Error(`Unknown Terminal Model recording: ${id}`)
  return recording
}

function recordRendererFailure(terminalKey: string) {
  return (failure: TerminalViewRendererFailure): void => {
    rendererFailures.push({ terminalKey, renderer: failure.renderer, reason: failure.reason })
  }
}

function disposeConcurrentLifecycle(): void {
  concurrentView?.dispose()
  concurrentView = null
  concurrentHost?.remove()
  concurrentHost = null
  concurrentSequence = 0
  main.style.removeProperty('width')
  main.style.removeProperty('height')
  main.style.removeProperty('position')
}

function nextAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

async function createConcurrentView(): Promise<{ view: TerminalView; evidence: TerminalViewPresentationEvidence }> {
  if (!concurrentHost) throw new Error('Concurrent terminal lifecycle has not been prepared')
  const terminalKey = 'KVG-4002-lifecycle-churn'
  const nextView = renderer.createView({
    terminalKey,
    themeMode: currentTheme,
    enableImages: false,
    loggerName: 'terminal-conformance-lifecycle',
    openLink: async () => {},
    fontReadiness: await preloadTerminalFonts(),
  })
  nextView.onRendererFailure(recordRendererFailure(terminalKey))
  nextView.mount(concurrentHost)
  nextView.fit()
  concurrentSequence = 0
  nextView.bootstrap('\u001b[?25lsecondary lifecycle terminal', ptyInstanceId, concurrentSequence)
  concurrentView = nextView
  return { view: nextView, evidence: await nextView.drainPresentation() }
}

function createLifecycleChurn(cycle: number, cols: number, rows: number): string {
  const printableCols = Math.max(1, cols - 2)
  const printableRows = Math.max(1, rows - 1)
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let output = '\u001b[?25l\u001b[2J\u001b[H'
  for (let row = 0; row < printableRows; row += 1) {
    for (let column = 0; column < printableCols; column += 1) {
      const cell = cycle * printableCols * printableRows + row * printableCols + column
      const foreground = (cell * 17) % 256
      const background = (cell * 29) % 64
      const character = characters[cell % characters.length]
      output += `\u001b[38;5;${foreground}m\u001b[48;5;${background}m${character}`
    }
    if (row + 1 < printableRows) output += '\u001b[0m\r\n'
  }
  return `${output}\u001b[0m`
}

async function reset(options: ResetOptions): Promise<TerminalViewPresentationEvidence> {
  disposeConcurrentLifecycle()
  rendererFailures = []
  currentTheme = options.theme
  inputRecorder.reset()
  view?.dispose()
  view = null
  host.replaceChildren()
  outputSequence = 0
  openedLinks = []
  echoInput = options.echoInput ?? false
  inputPresentation = Promise.resolve(null)

  const width = options.width ?? 960
  const height = options.height ?? 540
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  document.documentElement.dataset.theme = options.theme
  surfaceLabel.textContent = options.surface === 'agent' ? 'Agent terminal' : 'Terminal plugin shell'

  const fontReadiness = await preloadTerminalFonts()
  const theme = getTerminalTheme(options.theme)
  host.style.setProperty('--terminal-background', theme.background ?? 'transparent')
  const terminalKey = options.surface === 'agent' ? 'KVG-4002' : 'KVG-4002-shell-0'
  const nextView = renderer.createView({
    terminalKey,
    themeMode: options.theme,
    enableImages: false,
    loggerName: 'terminal-conformance',
    openLink: async url => { openedLinks.push(url) },
    fontReadiness,
  })
  nextView.onRendererFailure(recordRendererFailure(terminalKey))
  inputRecorder.subscribe(listener => nextView.onUserInput(listener), data => {
    if (!echoInput) return
    outputSequence += 1
    nextView.writeLive({ data, ptyInstanceId, sequence: outputSequence })
    inputPresentation = nextView.drainPresentation()
  })
  nextView.mount(host)
  nextView.fit()
  view = nextView
  return nextView.drainPresentation()
}

async function play(id: string): Promise<PlayResult> {
  const activeView = requireView()
  const recording = recordingById(id)
  recording.chunks.forEach((chunk, index) => {
    if (index === 0) {
      outputSequence = 0
      activeView.bootstrap(chunk, ptyInstanceId, outputSequence)
      return
    }
    outputSequence += 1
    activeView.writeLive({ data: chunk, ptyInstanceId, sequence: outputSequence })
  })
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function writeRepeated(data: string, repetitions: number): Promise<PlayResult> {
  const activeView = requireView()
  for (let index = 0; index < repetitions; index += 1) {
    outputSequence += 1
    activeView.writeLive({ data, ptyInstanceId, sequence: outputSequence })
  }
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function resize(width: number, height: number): Promise<PlayResult> {
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  const activeView = requireView()
  activeView.fit()
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function detachAndReattach(): Promise<PlayResult> {
  const activeView = requireView()
  activeView.unmount()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  activeView.mount(host)
  activeView.fit()
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function prepareConcurrentLifecycle(): Promise<ConcurrentLifecycleResult> {
  const activeView = requireView()
  disposeConcurrentLifecycle()
  main.style.width = '1000px'
  main.style.height = '340px'
  main.style.position = 'relative'
  host.style.width = '500px'
  host.style.height = '300px'
  activeView.fit()

  const theme = getTerminalTheme(currentTheme)
  const nextHost = document.createElement('div')
  nextHost.id = 'concurrent-terminal-host'
  nextHost.setAttribute('aria-label', 'Concurrent terminal lifecycle churn surface')
  nextHost.style.position = 'absolute'
  nextHost.style.left = '500px'
  nextHost.style.top = '40px'
  nextHost.style.width = '500px'
  nextHost.style.height = '300px'
  nextHost.style.padding = '10px'
  nextHost.style.background = theme.background ?? 'transparent'
  main.appendChild(nextHost)
  concurrentHost = nextHost

  outputSequence += 1
  activeView.writeLive({
    data: `\u001b[?25l\u001b[2J\u001b[HUNCHANGED_SENTINEL_0123456789\u001b[${activeView.geometry.rows};1HBOTTOM_SENTINEL_9876543210`,
    ptyInstanceId,
    sequence: outputSequence,
  })
  const [{ evidence: secondaryEvidence }, evidence] = await Promise.all([
    createConcurrentView(),
    activeView.drainPresentation(),
  ])
  return {
    evidence,
    presentation: activeView.capturePresentation(),
    rendererFailures: [...rendererFailures],
    secondaryEvidence,
  }
}

async function runConcurrentLifecycleCycle(cycle: number): Promise<ConcurrentLifecycleResult> {
  const activeView = requireView()
  const activeConcurrentView = concurrentView
  if (!activeConcurrentView || !concurrentHost) {
    throw new Error('Concurrent terminal lifecycle has not been prepared')
  }

  concurrentSequence += 1
  activeConcurrentView.writeLive({
    data: createLifecycleChurn(cycle, activeConcurrentView.geometry.cols, activeConcurrentView.geometry.rows),
    ptyInstanceId,
    sequence: concurrentSequence,
  })
  await activeConcurrentView.drainPresentation()

  activeView.setVisible(false)
  activeView.unmount()
  await nextAnimationFrame()
  activeView.mount(host)
  activeView.fit()
  activeView.setVisible(true)
  activeView.refresh()
  const evidence = await activeView.drainPresentation()

  activeConcurrentView.dispose()
  concurrentHost.replaceChildren()
  concurrentView = null
  const { evidence: secondaryEvidence } = await createConcurrentView()
  return {
    evidence,
    presentation: activeView.capturePresentation(),
    rendererFailures: [...rendererFailures],
    secondaryEvidence,
  }
}

async function reconnect(id: string): Promise<PlayResult> {
  const activeView = requireView()
  activeView.reset()
  const recording = recordingById(id)
  outputSequence = 0
  activeView.bootstrap(recording.chunks.join(''), ptyInstanceId, outputSequence)
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function waitForInputCount(count: number): Promise<PlayResult> {
  const deadline = performance.now() + 3_000
  while (inputRecorder.snapshot().length < count) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${count} terminal input event(s)`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await inputPresentation
  const activeView = requireView()
  return {
    evidence: await activeView.drainPresentation(),
    presentation: activeView.capturePresentation(),
  }
}

const api = {
  renderer: renderer.id,
  corpus: terminalModelRecordingCorpus,
  presentationRecordings: getPresentationRecordings(),
  reset,
  play,
  writeRepeated,
  resize,
  detachAndReattach,
  prepareConcurrentLifecycle,
  runConcurrentLifecycleCycle,
  reconnect,
  focus: () => requireView().focus(),
  drain: () => requireView().drainPresentation(),
  capture: () => requireView().capturePresentation(),
  clearInput: () => { inputRecorder.clear() },
  inputEvents: () => inputRecorder.snapshot(),
  openedLinks: () => [...openedLinks],
  waitForInputCount,
}

declare global {
  interface Window {
    terminalConformance: typeof api
  }
}

window.terminalConformance = api
