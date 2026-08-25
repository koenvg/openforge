import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import VoiceInput from './VoiceInput.svelte'
import { toggleVoiceInputShortcut } from '../../../lib/voiceInputShortcut'

vi.mock('../../../lib/ipc', () => ({
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  downloadWhisperModel: vi.fn(),
}))

vi.mock('../../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

import { getWhisperModelStatus, transcribeAudio } from '../../../lib/ipc'
import { createAudioRecorder } from '../../../lib/audioRecorder'

function unavailableWhisperModelStatus(): Awaited<ReturnType<typeof getWhisperModelStatus>> {
  return {
    size: 'small',
    display_name: 'Small',
    downloaded: false,
    model_path: null,
    model_size_bytes: null,
    model_name: 'ggml-small.bin',
    disk_size_mb: 466,
    ram_usage_mb: 1000,
    is_active: true,
  }
}

function mockUnavailableWhisperModel() {
  vi.mocked(getWhisperModelStatus).mockResolvedValue(unavailableWhisperModelStatus())
}

function availableWhisperModelStatus(): Awaited<ReturnType<typeof getWhisperModelStatus>> {
  return {
    size: 'small',
    display_name: 'Small',
    downloaded: true,
    model_path: '/models/ggml-small.bin',
    model_size_bytes: 1,
    model_name: 'ggml-small.bin',
    disk_size_mb: 466,
    ram_usage_mb: 1000,
    is_active: true,
  }
}

describe('VoiceInput', () => {
  const baseProps = {
    onTranscription: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders mic button in idle state', () => {
    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    expect(button).toBeTruthy()
  })

  it('shows model not downloaded message when model status returns downloaded: false', async () => {
    mockUnavailableWhisperModel()

    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    await fireEvent.click(button)
    await new Promise((r) => setTimeout(r, 10))

    expect(screen.getByText('Download model in Settings first')).toBeTruthy()
  })

  it('does not schedule a model error after unmount while status is pending', async () => {
    let resolveModelStatus!: (status: Awaited<ReturnType<typeof getWhisperModelStatus>>) => void
    const modelStatus = new Promise<Awaited<ReturnType<typeof getWhisperModelStatus>>>((resolve) => {
      resolveModelStatus = resolve
    })
    vi.mocked(getWhisperModelStatus).mockReturnValue(modelStatus)

    const view = render(VoiceInput, { props: baseProps })
    await fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))
    await vi.waitFor(() => expect(getWhisperModelStatus).toHaveBeenCalledOnce())
    view.unmount()

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      resolveModelStatus(unavailableWhisperModelStatus())
      await modelStatus
      await Promise.resolve()

      const scheduledErrorTimer = setTimeoutSpy.mock.calls.some(([, delay]) => delay === 3000)
      expect(scheduledErrorTimer).toBe(false)
    } finally {
      for (const result of setTimeoutSpy.mock.results) {
        if (result.type === 'return') clearTimeout(result.value)
      }
      setTimeoutSpy.mockRestore()
    }
  })

  it('disables button when disabled prop is true', () => {
    render(VoiceInput, { props: { ...baseProps, disabled: true } })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('button has microphone SVG icon', () => {
    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    const svg = button.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('passes the recorded Float32Array to the IPC wrapper without expanding it to numbers', async () => {
    const audioData = new Float32Array([0, 0.25, -0.25])
    const recorder = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(audioData),
      isRecording: vi.fn().mockReturnValue(true),
      getDuration: vi.fn().mockReturnValue(0),
      dispose: vi.fn(),
    }
    vi.mocked(getWhisperModelStatus).mockResolvedValue(availableWhisperModelStatus())
    vi.mocked(createAudioRecorder).mockReturnValue(recorder)
    vi.mocked(transcribeAudio).mockResolvedValue({ text: 'hello', duration_ms: 12 })

    render(VoiceInput, { props: baseProps })
    const startButton = screen.getByRole('button', { name: 'Start voice input' })
    await fireEvent.click(startButton)
    const stopButton = await screen.findByRole('button', { name: 'Stop recording' })
    await fireEvent.click(stopButton)

    expect(transcribeAudio).toHaveBeenCalledWith(audioData)
    expect(baseProps.onTranscription).toHaveBeenCalledWith('hello')
  })

  it('shows keyboard shortcut hint in tooltip', () => {
    render(VoiceInput, { props: baseProps })
    const button = screen.getByRole('button', { name: 'Start voice input' })
    expect(button.getAttribute('title')).toBe('Voice input (⌘D)')
  })

  it('responds to the voice shortcut when listenToHotkey is true', async () => {
    mockUnavailableWhisperModel()

    render(VoiceInput, { props: { ...baseProps, listenToHotkey: true } })
    toggleVoiceInputShortcut()
    await new Promise((r) => setTimeout(r, 10))

    expect(getWhisperModelStatus).toHaveBeenCalled()
  })

  it('starts only one recording while repeated shortcut requests wait for model status', async () => {
    let resolveModelStatus!: (status: Awaited<ReturnType<typeof getWhisperModelStatus>>) => void
    vi.mocked(getWhisperModelStatus).mockImplementation(() => new Promise((resolve) => {
      resolveModelStatus = resolve
    }))
    const recorder = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isRecording: vi.fn().mockReturnValue(false),
      getDuration: vi.fn().mockReturnValue(0),
      dispose: vi.fn(),
    }
    vi.mocked(createAudioRecorder).mockReturnValue(recorder)

    render(VoiceInput, { props: { ...baseProps, listenToHotkey: true } })
    toggleVoiceInputShortcut()
    toggleVoiceInputShortcut()

    expect(getWhisperModelStatus).toHaveBeenCalledOnce()
    expect(createAudioRecorder).not.toHaveBeenCalled()

    resolveModelStatus(availableWhisperModelStatus())
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())

    expect(createAudioRecorder).toHaveBeenCalledOnce()
  })

  it('starts only one recording while repeated shortcut requests wait for recorder startup', async () => {
    let resolveRecorderStart!: () => void
    vi.mocked(getWhisperModelStatus).mockResolvedValue(availableWhisperModelStatus())
    const recorder = {
      start: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveRecorderStart = resolve
      })),
      stop: vi.fn(),
      isRecording: vi.fn().mockReturnValue(false),
      getDuration: vi.fn().mockReturnValue(0),
      dispose: vi.fn(),
    }
    vi.mocked(createAudioRecorder).mockReturnValue(recorder)

    render(VoiceInput, { props: { ...baseProps, listenToHotkey: true } })
    toggleVoiceInputShortcut()
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())
    toggleVoiceInputShortcut()

    expect(createAudioRecorder).toHaveBeenCalledOnce()
    expect(recorder.start).toHaveBeenCalledOnce()

    resolveRecorderStart()
    await screen.findByRole('button', { name: 'Stop recording' })
  })

  it('disposes a recorder that finishes starting after unmount', async () => {
    let resolveRecorderStart!: () => void
    let started = false
    vi.mocked(getWhisperModelStatus).mockResolvedValue(availableWhisperModelStatus())
    const recorder = {
      start: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveRecorderStart = () => {
          started = true
          resolve()
        }
      })),
      stop: vi.fn().mockResolvedValue(new Float32Array()),
      isRecording: vi.fn(() => started),
      getDuration: vi.fn().mockReturnValue(0),
      dispose: vi.fn(),
    }
    vi.mocked(createAudioRecorder).mockReturnValue(recorder)

    const view = render(VoiceInput, { props: baseProps })
    await fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalledOnce())

    view.unmount()
    expect(recorder.dispose).toHaveBeenCalledOnce()

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      resolveRecorderStart()
      await recorder.start.mock.results[0].value
      await Promise.resolve()

      const startedDurationInterval = setIntervalSpy.mock.calls.some(([, delay]) => delay === 1000)
      expect(recorder.stop).not.toHaveBeenCalled()
      expect(startedDurationInterval).toBe(false)
    } finally {
      for (const result of setIntervalSpy.mock.results) {
        if (result.type === 'return') clearInterval(result.value)
      }
      setIntervalSpy.mockRestore()
    }
  })

  it('ignores the voice shortcut when listenToHotkey is false', async () => {
    render(VoiceInput, { props: { ...baseProps, listenToHotkey: false } })
    toggleVoiceInputShortcut()
    await new Promise((r) => setTimeout(r, 10))

    expect(getWhisperModelStatus).not.toHaveBeenCalled()
  })

  it('registers for the voice shortcut when listenToHotkey becomes true', async () => {
    mockUnavailableWhisperModel()
    const view = render(VoiceInput, { props: { ...baseProps, listenToHotkey: false } })

    expect(toggleVoiceInputShortcut()).toBe(false)

    await view.rerender({ ...baseProps, listenToHotkey: true })
    expect(toggleVoiceInputShortcut()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getWhisperModelStatus).toHaveBeenCalledOnce()
  })

  it('ignores the voice shortcut when disabled', async () => {
    render(VoiceInput, { props: { ...baseProps, listenToHotkey: true, disabled: true } })
    toggleVoiceInputShortcut()
    await new Promise((r) => setTimeout(r, 10))

    expect(getWhisperModelStatus).not.toHaveBeenCalled()
  })

  it('starts only one recording when multiple voice inputs listen to the shortcut', async () => {
    mockUnavailableWhisperModel()

    render(VoiceInput, { props: { onTranscription: vi.fn(), listenToHotkey: true } })
    render(VoiceInput, { props: { onTranscription: vi.fn(), listenToHotkey: true } })

    expect(toggleVoiceInputShortcut()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(getWhisperModelStatus).toHaveBeenCalledOnce()
  })
})
