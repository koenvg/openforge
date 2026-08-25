<script lang="ts">
  import { onDestroy } from 'svelte'
  import { createAudioRecorder } from '../../../lib/audioRecorder'
  import type { AudioRecorder } from '../../../lib/audioRecorder'
  import { transcribeAudio, getWhisperModelStatus } from '../../../lib/ipc'
  import type { VoiceInputState } from '../../../lib/types'
  import { registerVoiceInputShortcutTarget } from '../../../lib/voiceInputShortcut'

  interface Props {
    onTranscription: (text: string) => void
    disabled?: boolean
    listenToHotkey?: boolean
    showLabel?: boolean
    showShortcut?: boolean
    appearance?: 'ghost' | 'outline'
    size?: 'sm' | 'md'
  }

  let { onTranscription, disabled = false, listenToHotkey = false, showLabel = false, showShortcut = true, appearance = 'ghost', size = 'sm' }: Props = $props()

  // ── State ────────────────────────────────────────────────────────────────────
  let voiceState = $state<VoiceInputState>('idle')
  let recordingDuration = $state(0)
  let errorMessage = $state<string | null>(null)

  let isStarting = false
  let destroyed = false
  let recorder: AudioRecorder | null = null
  let durationInterval: ReturnType<typeof setInterval> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  let rootElement: HTMLDivElement | null = null
  let unregisterHotkeyTarget: (() => void) | null = null

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  function clearDurationInterval() {
    if (durationInterval !== null) {
      clearInterval(durationInterval)
      durationInterval = null
    }
  }

  function clearErrorTimer() {
    if (errorTimer !== null) {
      clearTimeout(errorTimer)
      errorTimer = null
    }
  }

  function showError(message: string) {
    clearErrorTimer()
    voiceState = 'error'
    errorMessage = message
    errorTimer = setTimeout(() => {
      voiceState = 'idle'
      errorMessage = null
      errorTimer = null
    }, 3000)
  }

  // ── Recording flow ────────────────────────────────────────────────────────────
  function handleMaxDuration() {
    void stopAndTranscribe()
  }

  async function stopAndTranscribe() {
    clearDurationInterval()
    voiceState = 'transcribing'

    if (!recorder) return

    const currentRecorder = recorder
    recorder = null

    try {
      const audioData = await currentRecorder.stop()
      const result = await transcribeAudio(audioData)
      onTranscription(result.text)
      voiceState = 'idle'
    } catch (e) {
      showError('Voice transcription failed.')
    }
  }

  // ── Click handler ─────────────────────────────────────────────────────────────
  async function handleClick() {
    if (disabled) return

    if (voiceState === 'recording') {
      await stopAndTranscribe()
      return
    }

    if (voiceState !== 'idle' || isStarting) return
    isStarting = true
    try {
      const status = await getWhisperModelStatus()
      if (destroyed) return
      if (!status.downloaded) {
        showError('Download model in Settings first')
        return
      }

      const startingRecorder = createAudioRecorder({
        maxDurationMs: 180000,
        onMaxDuration: handleMaxDuration
      })
      recorder = startingRecorder

      await startingRecorder.start()
      if (destroyed || recorder !== startingRecorder) return
      voiceState = 'recording'
      recordingDuration = 0
      durationInterval = setInterval(() => {
        if (recorder) {
          recordingDuration = recorder.getDuration()
        }
      }, 1000)
    } catch (e) {
      recorder?.dispose()
      recorder = null
      clearDurationInterval()
      if (destroyed) return
      showError('Failed to start voice recording. Check microphone permissions.')
    } finally {
      isStarting = false
    }
  }

  // ── Hotkey registration ────────────────────────────────────────────────────
  $effect(() => {
    if (!listenToHotkey || !rootElement || unregisterHotkeyTarget) return

    unregisterHotkeyTarget = registerVoiceInputShortcutTarget({
      root: rootElement,
      isEnabled: () => !disabled && listenToHotkey,
      toggle: () => { void handleClick() },
    })
  })
  // ── Cleanup ───────────────────────────────────────────────────────────────────
  onDestroy(() => {
    destroyed = true
    unregisterHotkeyTarget?.()
    clearDurationInterval()
    clearErrorTimer()
    recorder?.dispose()
    recorder = null
  })
</script>

<div bind:this={rootElement} class="flex flex-col items-center gap-1">
  <button
    type="button"
    class="btn {size === 'md' ? 'h-10 min-h-10 px-4' : 'btn-sm'} {voiceState === 'recording' ? 'btn-error' : appearance === 'outline' ? 'btn-outline' : 'btn-ghost'}"
    onclick={handleClick}
    disabled={disabled || voiceState === 'transcribing'}
    aria-label={voiceState === 'recording' ? 'Stop recording' : 'Start voice input'}
    title={voiceState === 'recording' ? 'Stop recording (⌘D)' : 'Voice input (⌘D)'}
  >
    {#if voiceState === 'transcribing'}
      <span class="loading loading-spinner loading-xs"></span>
    {:else if voiceState === 'recording'}
      <span class="recording-pulse inline-block w-2 h-2 rounded-full bg-current"></span>
      <span class="text-xs tabular-nums">{formatDuration(recordingDuration)}</span>
    {:else}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
      {#if showLabel}<span>Voice input</span>{/if}
      {#if showShortcut}<span class="text-[0.65rem] opacity-50">⌘D</span>{/if}
    {/if}
  </button>

  {#if voiceState === 'error' && errorMessage}
    <span class="text-error text-xs">{errorMessage}</span>
  {/if}
</div>
