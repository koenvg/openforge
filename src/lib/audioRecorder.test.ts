import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAudioRecorder } from './audioRecorder'

const sourceNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
}

const workletPort = {
  onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null,
  close: vi.fn(),
}

const workletNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  port: workletPort,
}

const mediaTrack = { stop: vi.fn() }

const mockAudioContext = {
  sampleRate: 44100,
  audioWorklet: {
    addModule: vi.fn().mockResolvedValue(undefined),
  },
  createMediaStreamSource: vi.fn().mockReturnValue(sourceNode),
  destination: {},
  close: vi.fn().mockResolvedValue(undefined),
}

const sourceBuffer = {
  copyToChannel: vi.fn(),
}

const renderedSamples = new Float32Array([0.125])

const mockOfflineAudioContext = {
  createBuffer: vi.fn().mockReturnValue(sourceBuffer),
  createBufferSource: vi.fn().mockReturnValue({
    connect: vi.fn(),
    start: vi.fn(),
    buffer: null,
  }),
  destination: {},
  startRendering: vi.fn().mockResolvedValue({
    getChannelData: vi.fn().mockReturnValue(renderedSamples),
  }),
}

Object.defineProperty(global, 'AudioContext', {
  writable: true,
  value: vi.fn(function () { return mockAudioContext }),
})

Object.defineProperty(global, 'AudioWorkletNode', {
  writable: true,
  value: vi.fn(function () { return workletNode }),
})

Object.defineProperty(global, 'OfflineAudioContext', {
  writable: true,
  value: vi.fn(function () { return mockOfflineAudioContext }),
})

Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: vi.fn().mockReturnValue([mediaTrack]),
    }),
  },
})

describe('audioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workletPort.onmessage = null
  })

  it('createAudioRecorder returns object with expected interface', () => {
    const recorder = createAudioRecorder()
    expect(typeof recorder.start).toBe('function')
    expect(typeof recorder.stop).toBe('function')
    expect(typeof recorder.isRecording).toBe('function')
    expect(typeof recorder.getDuration).toBe('function')
    expect(typeof recorder.dispose).toBe('function')
  })

  it('captures microphone samples through an audio worklet as 16 kHz mono PCM', async () => {
    const recorder = createAudioRecorder()

    await recorder.start()
    expect(recorder.isRecording()).toBe(true)

    expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledOnce()
    expect(AudioWorkletNode).toHaveBeenCalledWith(mockAudioContext, 'openforge-audio-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    expect(sourceNode.connect).toHaveBeenCalledWith(workletNode)
    expect(workletNode.connect).toHaveBeenCalledWith(mockAudioContext.destination)

    const capturedSamples = new Float32Array([0.25, -0.5])
    workletPort.onmessage?.({ data: capturedSamples } as MessageEvent<Float32Array>)

    await expect(recorder.stop()).resolves.toBe(renderedSamples)
    expect(recorder.isRecording()).toBe(false)
    expect(workletPort.onmessage).toBeNull()
    expect(workletPort.close).toHaveBeenCalledOnce()
    expect(workletNode.disconnect).toHaveBeenCalledOnce()
    expect(sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
    expect(sourceBuffer.copyToChannel).toHaveBeenCalledWith(capturedSamples, 0)
    expect(OfflineAudioContext).toHaveBeenCalledWith(1, 1, 16000)
  })

  it('rejects a concurrent start without requesting another microphone stream', async () => {
    let resolveMediaStream!: (stream: MediaStream) => void
    const stream = {
      getTracks: vi.fn().mockReturnValue([mediaTrack]),
    } as unknown as MediaStream
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(() => new Promise((resolve) => {
      resolveMediaStream = resolve
    }))
    const recorder = createAudioRecorder()

    const startup = recorder.start()
    await expect(recorder.start()).rejects.toThrow('AudioRecorder: already recording')

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(AudioContext).not.toHaveBeenCalled()

    resolveMediaStream(stream)
    await startup
    recorder.dispose()
  })

  it('automatically stops at the maximum duration and returns the captured audio', async () => {
    vi.useFakeTimers()
    const onMaxDuration = vi.fn()
    const recorder = createAudioRecorder({ maxDurationMs: 100, onMaxDuration })

    try {
      await recorder.start()
      expect(recorder.isRecording()).toBe(true)
      workletPort.onmessage?.({ data: new Float32Array([0.5]) } as MessageEvent<Float32Array>)

      await vi.advanceTimersByTimeAsync(100)

      expect(recorder.isRecording()).toBe(false)
      expect(onMaxDuration).toHaveBeenCalledOnce()
      await expect(recorder.stop()).resolves.toBe(renderedSamples)
      expect(mediaTrack.stop).toHaveBeenCalledOnce()
      expect(mockAudioContext.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the microphone stream when AudioContext construction throws', async () => {
    vi.mocked(AudioContext).mockImplementationOnce(function () {
      throw new Error('audio context failed')
    })
    const recorder = createAudioRecorder()

    await expect(recorder.start()).rejects.toThrow('audio context failed')

    expect(recorder.isRecording()).toBe(false)
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).not.toHaveBeenCalled()

    await expect(recorder.start()).resolves.toBeUndefined()
    expect(recorder.isRecording()).toBe(true)
    recorder.dispose()
  })

  it('releases microphone resources when audio worklet startup fails', async () => {
    mockAudioContext.audioWorklet.addModule.mockRejectedValueOnce(new Error('worklet load failed'))
    const recorder = createAudioRecorder()

    await expect(recorder.start()).rejects.toThrow('worklet load failed')

    expect(recorder.isRecording()).toBe(false)
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
  })

  it('releases microphone and audio graph resources when AudioWorkletNode construction throws', async () => {
    vi.mocked(AudioWorkletNode).mockImplementationOnce(function () {
      throw new Error('worklet node failed')
    })
    const recorder = createAudioRecorder()

    await expect(recorder.start()).rejects.toThrow('worklet node failed')

    expect(recorder.isRecording()).toBe(false)
    expect(sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
  })

  it('releases resources when connecting the media source throws', async () => {
    sourceNode.connect.mockImplementationOnce(() => {
      throw new Error('source connection failed')
    })
    const recorder = createAudioRecorder()

    await expect(recorder.start()).rejects.toThrow('source connection failed')

    expect(recorder.isRecording()).toBe(false)
    expect(workletPort.close).toHaveBeenCalledOnce()
    expect(workletNode.disconnect).toHaveBeenCalledOnce()
    expect(sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
  })

  it('releases resources when connecting the worklet node throws', async () => {
    workletNode.connect.mockImplementationOnce(() => {
      throw new Error('worklet connection failed')
    })
    const recorder = createAudioRecorder()

    await expect(recorder.start()).rejects.toThrow('worklet connection failed')

    expect(recorder.isRecording()).toBe(false)
    expect(sourceNode.connect).toHaveBeenCalledWith(workletNode)
    expect(workletPort.close).toHaveBeenCalledOnce()
    expect(workletNode.disconnect).toHaveBeenCalledOnce()
    expect(sourceNode.disconnect).toHaveBeenCalledOnce()
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
  })

  it('can be disposed while the audio worklet module is loading', async () => {
    let resolveModule!: () => void
    mockAudioContext.audioWorklet.addModule.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveModule = resolve
    }))
    const recorder = createAudioRecorder()

    const startup = recorder.start()
    await vi.waitFor(() => {
      expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledOnce()
    })
    recorder.dispose()
    resolveModule()

    await expect(startup).rejects.toThrow('AudioRecorder: disposed')
    expect(mediaTrack.stop).toHaveBeenCalledOnce()
    expect(mockAudioContext.close).toHaveBeenCalledOnce()
    expect(AudioWorkletNode).not.toHaveBeenCalled()
  })

  it('releases a late media stream when disposed during startup', async () => {
    let resolveMediaStream!: (stream: MediaStream) => void
    const track = { stop: vi.fn() }
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(() => new Promise<MediaStream>((resolve) => {
      resolveMediaStream = resolve
    }))

    const recorder = createAudioRecorder()
    const startup = recorder.start()
    recorder.dispose()
    resolveMediaStream({
      getTracks: () => [track],
    } as unknown as MediaStream)

    await expect(startup).rejects.toThrow('AudioRecorder: disposed')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(AudioContext).not.toHaveBeenCalled()
  })

  it('isRecording returns false initially', () => {
    const recorder = createAudioRecorder()
    expect(recorder.isRecording()).toBe(false)
  })

  it('getDuration returns 0 initially', () => {
    const recorder = createAudioRecorder()
    expect(recorder.getDuration()).toBe(0)
  })

  it('respects maxDurationMs option', () => {
    const recorder = createAudioRecorder({ maxDurationMs: 60000 })
    expect(recorder).toBeTruthy()
    expect(recorder.isRecording()).toBe(false)
  })
})
