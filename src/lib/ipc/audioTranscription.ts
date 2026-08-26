import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { TranscriptionResult, WhisperModelSizeId, WhisperModelStatus } from '../types'

function encodeFloat32PcmBase64(audioData: Float32Array): string {
  const bytes = new Uint8Array(audioData.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < audioData.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, audioData[index], true);
  }

  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    let chunk = "";
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) {
      chunk += String.fromCharCode(bytes[index]);
    }
    binary += chunk;
  }

  return btoa(binary);
}

export async function transcribeAudio(audioData: Float32Array): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", { audioPcmBase64: encodeFloat32PcmBase64(audioData) });
}

export async function getWhisperModelStatus(): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("get_whisper_model_status");
}

export async function downloadWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("download_whisper_model", { modelSize });
}

export async function getAllWhisperModelStatuses(): Promise<WhisperModelStatus[]> {
  return invoke<WhisperModelStatus[]>("get_all_whisper_model_statuses");
}

export async function setWhisperModel(modelSize: WhisperModelSizeId): Promise<void> {
  return invoke<void>("set_whisper_model", { modelSize });
}
