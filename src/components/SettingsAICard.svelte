<script lang="ts">
  import { Brain } from 'lucide-svelte'
  import ModelDownloadProgress from './ModelDownloadProgress.svelte'
  import type { WhisperModelStatus, WhisperModelSizeId } from '../lib/types'

  interface Props {
    aiProvider: string
    aiProviderInstalled: boolean
    aiProviderVersion: string | null
    claudeAuthenticated: boolean
    opencodeInstalled: boolean
    opencodeVersion: string | null
    claudeInstalled: boolean
    claudeVersion: string | null
    modelStatuses: WhisperModelStatus[]
    activeModelSize: string | null
    downloadingModel: string | null
    onAiProviderChange: (value: string) => void
    onWhisperModelSelect: (modelSize: string) => void
    onDownloadModel: (modelSize: string) => void
    onDownloadComplete: () => void
    onDownloadError: () => void
  }

  let {
    aiProvider,
    aiProviderInstalled,
    aiProviderVersion,
    claudeAuthenticated,
    opencodeInstalled,
    opencodeVersion,
    claudeInstalled,
    claudeVersion,
    modelStatuses,
    activeModelSize,
    downloadingModel,
    onAiProviderChange,
    onWhisperModelSelect,
    onDownloadModel,
    onDownloadComplete,
    onDownloadError
  }: Props = $props()

  function formatSize(mb: number): string {
    return mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB'
  }

  const activeModel = $derived(modelStatuses.find(m => m.size === activeModelSize))
</script>

<div id="section-ai" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
  <!-- Header -->
  <div class="px-5 py-4 border-b border-base-300 flex items-center gap-3">
    <Brain size={16} class="text-primary" />
    <h2 class="text-sm font-semibold">AI Configuration</h2>
    {#if aiProviderInstalled}
      <span class="badge badge-success badge-sm ml-auto">Installed</span>
    {:else}
      <span class="badge badge-error badge-sm ml-auto">Not Installed</span>
    {/if}
  </div>

  <!-- Body -->
  <div class="p-5 flex flex-col gap-4">
    <!-- Row 1: AI Provider + Whisper Model (2-column grid) -->
    <div class="grid grid-cols-2 gap-4">
      <!-- AI Provider Select -->
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">AI Provider</span>
        <select
          class="select select-bordered select-sm w-full"
          value={aiProvider}
          onchange={(e) => onAiProviderChange((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>

      <!-- Whisper Model Select -->
      <label class="flex flex-col gap-1">
        <span class="text-[0.7rem] text-base-content/50">Whisper Model</span>
        <select
          class="select select-bordered select-sm w-full"
          value={activeModelSize ?? 'small'}
          onchange={(e) => onWhisperModelSelect((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each modelStatuses as model}
            <option value={model.size}>
              {model.display_name} — {formatSize(model.disk_size_mb)} download, ~{formatSize(model.ram_usage_mb)} RAM{model.downloaded ? ' ✓' : ''}
            </option>
          {/each}
        </select>
      </label>
    </div>

    <!-- AI Provider Install Status Indicators -->
    <div class="flex flex-col gap-1 text-xs">
      <div class="flex items-center gap-2">
        {#if opencodeInstalled}
          <span class="text-success">✓</span>
          <span>OpenCode {opencodeVersion || ''}</span>
        {:else}
          <span class="text-error">✗</span>
          <span class="text-base-content/50">OpenCode not installed</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if claudeInstalled}
          <span class="text-success">✓</span>
          <span>Claude Code {claudeVersion || ''}</span>
          {#if claudeAuthenticated}
            <span class="badge badge-xs badge-success">Authenticated</span>
          {:else}
            <span class="badge badge-xs badge-warning">Not authenticated</span>
          {/if}
        {:else}
          <span class="text-error">✗</span>
          <span class="text-base-content/50">Claude Code not installed</span>
        {/if}
      </div>
    </div>

    <!-- Warning if selected provider not installed -->
    {#if (aiProvider === 'opencode' && !opencodeInstalled) || (aiProvider === 'claude-code' && !claudeInstalled)}
      <div class="alert alert-warning text-xs py-2">
        <span>⚠ Selected provider is not installed</span>
      </div>
    {/if}

    <!-- Whisper Model Download Status / Progress -->
    {#if downloadingModel}
      <ModelDownloadProgress
        modelSize={downloadingModel as WhisperModelSizeId}
        modelDisplayName={modelStatuses.find(m => m.size === downloadingModel)?.display_name ?? downloadingModel}
        diskSizeMb={modelStatuses.find(m => m.size === downloadingModel)?.disk_size_mb ?? 0}
        onComplete={onDownloadComplete}
        onError={onDownloadError}
      />
    {:else if activeModel?.downloaded}
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="badge badge-success badge-sm">Downloaded</span>
          <span class="text-[0.7rem] text-base-content/50">{activeModel.model_name}</span>
        </div>
        {#if activeModel.model_size_bytes}
          <span class="text-[0.7rem] text-base-content/50">
            Size: {(activeModel.model_size_bytes / 1024 / 1024).toFixed(0)} MB
          </span>
        {/if}
        {#if activeModel.model_path}
          <span class="text-[0.7rem] text-base-content/50 break-all">
            Path: {activeModel.model_path}
          </span>
        {/if}
        <button class="btn btn-ghost btn-sm mt-1" onclick={() => onDownloadModel(activeModel.size)}>
          Re-download Model
        </button>
      </div>
    {:else if activeModel}
      <div class="flex flex-col gap-2">
        <p class="text-[0.7rem] text-base-content/50">Whisper {activeModel.display_name} model required for voice dictation (~{formatSize(activeModel.disk_size_mb)} download).</p>
        <button class="btn btn-primary btn-sm" onclick={() => onDownloadModel(activeModel.size)}>
          Download Model
        </button>
      </div>
    {/if}

    <p class="text-[0.7rem] text-base-content/50 mt-1">
      {#if activeModel}
        Uses approximately {formatSize(activeModel.ram_usage_mb)} of RAM during transcription.
      {:else}
        Uses approximately 1 GB of RAM during transcription.
      {/if}
    </p>
    <p class="text-[0.7rem] text-base-content/50">Note: macOS may re-prompt for microphone permission on each app launch (Tauri v2 known issue).</p>
  </div>
</div>
