import { describe, expect, it, vi } from 'vitest'

const worklet = vi.hoisted(() => {
  const postMessage = vi.fn()
  const registerProcessor = vi.fn()

  class MockAudioWorkletProcessor {
    readonly port = { postMessage }
  }

  Object.defineProperty(globalThis, 'AudioWorkletProcessor', {
    configurable: true,
    value: MockAudioWorkletProcessor,
  })
  Object.defineProperty(globalThis, 'registerProcessor', {
    configurable: true,
    value: registerProcessor,
  })

  return { postMessage, registerProcessor }
})

await import('./audioRecorder.worklet')

describe('audio recorder worklet', () => {
  it('copies the first mono input channel to the recorder message port', () => {
    const Processor = worklet.registerProcessor.mock.calls[0]?.[1] as new () => {
      process(inputs: Float32Array[][]): boolean
    }
    const processor = new Processor()
    const input = new Float32Array([0.25, -0.5])

    expect(processor.process([[input]])).toBe(true)

    const [samples, transfer] = worklet.postMessage.mock.calls[0] as [Float32Array, ArrayBuffer[]]
    expect(samples).toEqual(input)
    expect(samples).not.toBe(input)
    expect(transfer).toEqual([samples.buffer])
  })
})
