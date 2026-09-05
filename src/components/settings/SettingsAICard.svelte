<script lang="ts">
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import { Brain } from '@lucide/svelte'
  import ModelDownloadProgress from '../shared/adapters/ModelDownloadProgress.svelte'
  import type { WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    modelStatuses: WhisperModelStatus[]
    activeModelSize: string | null
    downloadingModel: string | null
    onWhisperModelSelect: (modelSize: string) => void
    onDownloadModel: (modelSize: string) => void
    onDownloadComplete: () => void
    onDownloadError: () => void
  }

  let {
    modelStatuses,
    activeModelSize,
    downloadingModel,
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

<SettingsSectionCard id="section-ai" title="Voice & Whisper">
  {#snippet icon()}<Brain size={16} />{/snippet}
  <div class="flex flex-col gap-4">
    <!-- Whisper Model Select -->
    <Select
      label="Whisper Model"
      class="max-w-xs"
      value={activeModelSize ?? 'small'}
      onValueChange={onWhisperModelSelect}
      options={modelStatuses.map((model) => ({
        value: model.size,
        label: `${model.display_name} — ${formatSize(model.disk_size_mb)} download, ~${formatSize(model.ram_usage_mb)} RAM${model.downloaded ? ' ✓' : ''}`,
      }))}
    />

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
          <Badge variant="success">Downloaded</Badge>
          <span class="text-[0.7rem] text-[var(--of-text-muted)]">{activeModel.model_name}</span>
        </div>
        {#if activeModel.model_size_bytes}
          <span class="text-[0.7rem] text-[var(--of-text-muted)]">
            Size: {(activeModel.model_size_bytes / 1024 / 1024).toFixed(0)} MB
          </span>
        {/if}
        {#if activeModel.model_path}
          <span class="text-[0.7rem] text-[var(--of-text-muted)] break-all">
            Path: {activeModel.model_path}
          </span>
        {/if}
        <Button variant="ghost" size="sm" class="mt-1" onclick={() => onDownloadModel(activeModel.size)}>
          Re-download Model
        </Button>
      </div>
    {:else if activeModel}
      <div class="flex flex-col gap-2">
        <p class="text-[0.7rem] text-[var(--of-text-muted)]">Whisper {activeModel.display_name} model required for voice dictation (~{formatSize(activeModel.disk_size_mb)} download).</p>
        <Button variant="primary" size="sm" onclick={() => onDownloadModel(activeModel.size)}>
          Download Model
        </Button>
      </div>
    {/if}

    <p class="text-[0.7rem] text-[var(--of-text-muted)] mt-1">
      {#if activeModel}
        Uses approximately {formatSize(activeModel.ram_usage_mb)} of RAM during transcription.
      {:else}
        Uses approximately 1 GB of RAM during transcription.
      {/if}
    </p>
    <p class="text-[0.7rem] text-[var(--of-text-muted)]">
      OpenForge keeps the model in memory for five minutes after use so consecutive dictation stays fast, then releases it. The next dictation reloads the model and may start more slowly.
    </p>
    <p class="text-[0.7rem] text-[var(--of-text-muted)]">Note: macOS controls microphone access per installed app bundle; re-approve access after replacing a local build if prompted.</p>
  </div>
</SettingsSectionCard>
