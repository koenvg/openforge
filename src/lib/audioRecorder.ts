import audioRecorderWorkletUrl from './audioRecorder.worklet.ts?worker&url';

// Audio recorder utility — captures microphone audio and resamples to 16kHz
// mono float32 PCM, the input format required by Whisper.

const TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_MAX_DURATION_MS = 180_000;
const WORKLET_PROCESSOR_NAME = 'openforge-audio-recorder';

export interface AudioRecorderOptions {
  /** Maximum recording duration in milliseconds. Defaults to 180000 (3 min). */
  maxDurationMs?: number;
  /** Called when the recording reaches maxDurationMs and is automatically stopped. */
  onMaxDuration?: () => void;
}

export interface AudioRecorder {
  /** Start microphone capture. Throws if already recording or mic access is denied. */
  start(): Promise<void>;
  /** Stop recording and return a resampled 16kHz mono float32 PCM buffer. */
  stop(): Promise<Float32Array>;
  /** Returns true while recording is active. */
  isRecording(): boolean;
  /** Returns elapsed recording time in milliseconds. Returns 0 if not recording. */
  getDuration(): number;
  /** Release recorder resources without producing audio. Safe during startup and after disposal. */
  dispose(): void;
}

// ============================================================================
// Resampling
// ============================================================================

async function resampleToMono16k(
  chunks: Float32Array[],
  sourceSampleRate: number,
): Promise<Float32Array> {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);

  if (totalLength === 0) {
    return new Float32Array(0);
  }

  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const duration = totalLength / sourceSampleRate;
  const targetLength = Math.ceil(duration * TARGET_SAMPLE_RATE);

  // Resample using OfflineAudioContext:
  // 1. Create OfflineAudioContext with sampleRate=16000, length based on duration
  // 2. Create AudioBufferSourceNode from captured audio
  // 3. Connect and render
  // 4. Return rendered buffer's channel data
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const sourceBuffer = offlineCtx.createBuffer(1, totalLength, sourceSampleRate);
  sourceBuffer.copyToChannel(combined, 0);

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = sourceBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

// ============================================================================
// Factory
// ============================================================================

export function createAudioRecorder(options?: AudioRecorderOptions): AudioRecorder {
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const onMaxDuration = options?.onMaxDuration;

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processorNode: AudioWorkletNode | null = null;
  let chunks: Float32Array[] = [];
  let recording = false;
  let disposed = false;
  let startTime = 0;
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  // Set when auto-stop fires; stop() awaits this promise to get the result.
  let autoStopPromise: Promise<Float32Array> | null = null;

  function cleanup(): void {
    if (maxDurationTimer !== null) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    if (processorNode) {
      processorNode.port.onmessage = null;
      processorNode.port.close();
      processorNode.disconnect();
      processorNode = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
  }

  async function performStop(): Promise<Float32Array> {
    const capturedChunks = chunks.slice();
    const sampleRate = audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
    chunks = [];
    cleanup();
    return resampleToMono16k(capturedChunks, sampleRate);
  }

  return {
    async start(): Promise<void> {
      if (disposed) {
        throw new Error('AudioRecorder: disposed');
      }
      if (recording || autoStopPromise !== null) {
        throw new Error('AudioRecorder: already recording');
      }

      // macOS permission prompts are scoped to the installed app bundle. Local
      // replacement builds may require the user to grant microphone access again.
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed) {
        cleanup();
        throw new Error('AudioRecorder: disposed');
      }

      const context = new AudioContext();
      audioContext = context;
      try {
        await context.audioWorklet.addModule(audioRecorderWorkletUrl);
      } catch (error) {
        cleanup();
        throw error;
      }
      if (disposed) {
        cleanup();
        throw new Error('AudioRecorder: disposed');
      }

      sourceNode = context.createMediaStreamSource(mediaStream);
      processorNode = new AudioWorkletNode(context, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });

      chunks = [];
      recording = true;
      startTime = Date.now();

      processorNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!recording) return;
        chunks.push(event.data);
      };

      // Both nodes must be connected to destination to keep the audio graph active.
      // processorNode outputs silence since we never write to outputBuffer.
      sourceNode.connect(processorNode);
      processorNode.connect(audioContext.destination);

      maxDurationTimer = setTimeout(() => {
        maxDurationTimer = null;
        if (!recording) return;
        recording = false;
        autoStopPromise = performStop();
        onMaxDuration?.();
      }, maxDurationMs);
    },

    async stop(): Promise<Float32Array> {
      // If auto-stop already triggered, return its (possibly in-progress) result.
      if (autoStopPromise !== null) {
        const promise = autoStopPromise;
        autoStopPromise = null;
        return promise;
      }

      if (!recording) {
        throw new Error('AudioRecorder: not recording');
      }

      if (maxDurationTimer !== null) {
        clearTimeout(maxDurationTimer);
        maxDurationTimer = null;
      }

      recording = false;
      return performStop();
    },

    isRecording(): boolean {
      return recording;
    },

    getDuration(): number {
      if (!recording) return 0;
      return Date.now() - startTime;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      recording = false;
      chunks = [];
      autoStopPromise = null;
      cleanup();
    },
  };
}
