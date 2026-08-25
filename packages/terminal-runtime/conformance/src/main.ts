import { getTerminalConformanceRenderer } from './rendererRegistry'
import { getPresentationRecordings, terminalModelRecordingCorpus } from '../../src/terminalPresentationCorpus'
import { preloadTerminalFonts } from '../../src/terminalOptions'
import { getTerminalTheme, type ThemeMode } from '../../src/theme'
import type {
  TerminalView,
  TerminalViewDisposable,
  TerminalViewPresentationEvidence,
  TerminalViewPresentationSnapshot,
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

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Terminal conformance element is missing: ${selector}`)
  return element
}

const host = requiredElement('#terminal-host')
const surfaceLabel = requiredElement('#surface-kind')
const rendererLabel = requiredElement('#renderer-kind')
const renderer = getTerminalConformanceRenderer(new URLSearchParams(location.search).get('renderer') ?? 'xterm')
rendererLabel.textContent = renderer.id

let view: TerminalView | null = null
let inputSubscription: TerminalViewDisposable | null = null
let inputEvents: string[] = []
let openedLinks: string[] = []
let echoInput = false
let inputPresentation = Promise.resolve<TerminalViewPresentationEvidence | null>(null)

function requireView(): TerminalView {
  if (!view) throw new Error('Terminal conformance view has not been reset')
  return view
}

function recordingById(id: string) {
  const recording = terminalModelRecordingCorpus.recordings.find(candidate => candidate.id === id)
  if (!recording) throw new Error(`Unknown Terminal Model recording: ${id}`)
  return recording
}

async function reset(options: ResetOptions): Promise<TerminalViewPresentationEvidence> {
  inputSubscription?.dispose()
  inputSubscription = null
  view?.dispose()
  view = null
  host.replaceChildren()
  inputEvents = []
  openedLinks = []
  echoInput = options.echoInput ?? false
  inputPresentation = Promise.resolve(null)

  const width = options.width ?? 960
  const height = options.height ?? 540
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  document.documentElement.dataset.theme = options.theme
  surfaceLabel.textContent = options.surface === 'agent' ? 'Agent terminal' : 'Terminal plugin shell'

  await preloadTerminalFonts()
  const theme = getTerminalTheme(options.theme)
  host.style.setProperty('--terminal-background', theme.background ?? 'transparent')
  const nextView = renderer.createView({
    terminalKey: options.surface === 'agent' ? 'KVG-4002' : 'KVG-4002-shell-0',
    themeMode: options.theme,
    enableImages: false,
    loggerName: 'terminal-conformance',
    openLink: async url => { openedLinks.push(url) },
  })
  inputSubscription = nextView.onUserInput(data => {
    inputEvents.push(data)
    if (!echoInput) return
    nextView.writeLive({ data, sequence: null })
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
    if (index === 0) activeView.bootstrap(chunk)
    else activeView.writeLive({ data: chunk, sequence: index })
  })
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function writeRepeated(data: string, repetitions: number): Promise<PlayResult> {
  const activeView = requireView()
  for (let index = 0; index < repetitions; index += 1) {
    activeView.writeLive({ data, sequence: index })
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

async function reconnect(id: string): Promise<PlayResult> {
  const activeView = requireView()
  activeView.reset()
  const recording = recordingById(id)
  activeView.bootstrap(recording.chunks.join(''))
  const evidence = await activeView.drainPresentation()
  return { evidence, presentation: activeView.capturePresentation() }
}

async function waitForInputCount(count: number): Promise<PlayResult> {
  const deadline = performance.now() + 3_000
  while (inputEvents.length < count) {
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
  reconnect,
  focus: () => requireView().focus(),
  drain: () => requireView().drainPresentation(),
  capture: () => requireView().capturePresentation(),
  clearInput: () => { inputEvents = [] },
  inputEvents: () => [...inputEvents],
  openedLinks: () => [...openedLinks],
  waitForInputCount,
}

declare global {
  interface Window {
    terminalConformance: typeof api
  }
}

window.terminalConformance = api
