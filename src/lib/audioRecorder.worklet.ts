interface AudioWorkletProcessorInstance {
  readonly port: MessagePort
  process(inputs: Float32Array[][]): boolean
}

interface AudioWorkletProcessorConstructor {
  new (): AudioWorkletProcessorInstance
}

declare const AudioWorkletProcessor: AudioWorkletProcessorConstructor
declare function registerProcessor(name: string, processor: AudioWorkletProcessorConstructor): void

class AudioRecorderProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    if (input) {
      const samples = new Float32Array(input)
      this.port.postMessage(samples, [samples.buffer])
    }
    return true
  }
}

registerProcessor('openforge-audio-recorder', AudioRecorderProcessor)

export {}
