<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import { readApiKey, writeApiKey } from '../lib/settings/apiKey'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
  }

  let { api }: Props = $props()

  let key = $state('')
  // What's actually in storage, so a blur that changed nothing doesn't write.
  let saved = $state('')
  let loaded = $state(false)
  let error = $state<string | null>(null)

  void (async () => {
    key = await readApiKey(api.storage)
    saved = key
    loaded = true
  })()

  async function persist() {
    const next = key.trim()
    if (!loaded || next === saved) return
    error = null
    try {
      await writeApiKey(api.storage, next)
      saved = next
      key = next
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
    }
  }
</script>

<div class="flex flex-col gap-3 p-2">
  <div class="flex flex-col gap-2">
    <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="roadmap-anthropic-key">
      Anthropic API key
    </label>
    <input
      id="roadmap-anthropic-key"
      class="input input-bordered input-sm w-full"
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="sk-ant-…"
      bind:value={key}
      onblur={persist}
    />
    <p class="text-xs text-base-content/60 m-0">
      Enables <span class="font-semibold">Refine</span> on the roadmap board, which drafts a ticket from a rough note.
      Without a key, Refine stays disabled. Shared across all projects and stored on this machine only.
    </p>
  </div>

  {#if error}
    <p class="alert alert-error text-sm m-0" role="alert">{error}</p>
  {/if}
</div>
