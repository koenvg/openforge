<script lang="ts">
  import AppToast from '../../../src/components/feedback/toasts/AppToast.svelte'
  import ModelDownloadProgress from '../../../src/components/shared/adapters/ModelDownloadProgress.svelte'
  import ContextMenuItem from '../../../src/components/shared/ui/ContextMenuItem.svelte'

  let { onactivate = () => {}, ondismiss = () => {} }: { onactivate?: () => void; ondismiss?: () => void } = $props()
</script>

<main class="mx-auto flex max-w-xl flex-col gap-4 p-4" aria-label="Host feedback">
  <AppToast variant="loading" message="Preparing your workspace" timeout={0} onclick={onactivate} {ondismiss} />
  <ModelDownloadProgress modelSize="small" modelDisplayName="Small" diskSizeMb={466} />
  <div role="menu" aria-label="Host actions">
    <ContextMenuItem label="Open workspace" onclick={onactivate} />
    <ContextMenuItem label="Unavailable action" disabled onclick={onactivate} />
    <ContextMenuItem label="Delete workspace" variant="danger" onclick={onactivate} />
  </div>
  <article class="markdown-body" aria-label="Content preview">
    <h1>Workspace notes</h1>
    <p>Keep the <code>project</code> open while downloading.</p>
    <blockquote>Long content must wrap without changing the card width.</blockquote>
    <pre><code class="file-preview-code"><span class="hljs-keyword">const</span> <span class="hljs-string">ready</span></code></pre>
  </article>
</main>
