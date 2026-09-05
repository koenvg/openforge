<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  let nestedOpen = $state(false)
</script>

<main class="visual-shell" aria-label="Interaction overlay visual fixture">
  <section class="visual-workspace" aria-hidden="true">
    <p class="visual-eyebrow">OPENFORGE / PROJECT</p>
    <h1>Interaction workbench</h1>
    <div class="visual-grid">
      <div></div>
      <div></div>
      <div></div>
    </div>
  </section>

  <Modal
    ariaLabel="Scrollable project settings"
    maxWidth="620px"
    initialFocus={null}
    onClose={() => undefined}
  >
    {#snippet header()}
      <h2>Project settings</h2>
    {/snippet}

    <div class="dialog-content">
      <p class="dialog-intro">Review the inherited settings before applying them to this project.</p>
      <div class="settings-list">
        {#each Array.from({ length: 16 }, (_, index) => index + 1) as setting}
          <label>
            <span>
              <strong>Setting {setting}</strong>
              <small>Inherited from the application default</small>
            </span>
            <input type="checkbox" checked={setting % 3 !== 0} aria-label="Enable setting {setting}" />
          </label>
        {/each}
      </div>
      <div class="dialog-actions">
        <Button variant="ghost">Cancel</Button>
        <Button data-open-review-confirmation onclick={() => { nestedOpen = true }}>Open review confirmation</Button>
      </div>
    </div>
  </Modal>

  {#if nestedOpen}
    <Modal
      ariaLabel="Review project changes"
      maxWidth="380px"
      initialFocus="[data-confirm-review]"
      onClose={() => { nestedOpen = false }}
    >
      {#snippet header()}
        <h2>Review changes</h2>
      {/snippet}
      <div class="confirmation-content">
        <p>Apply these settings to the current project?</p>
        <div class="dialog-actions">
          <Button variant="ghost" onclick={() => { nestedOpen = false }}>Back</Button>
          <Button data-confirm-review onclick={() => { nestedOpen = false }}>Apply changes</Button>
        </div>
      </div>
    </Modal>
  {/if}
</main>

<style>
  :global(html),
  :global(body),
  :global(#app) {
    min-height: 100%;
    margin: 0;
  }

  :global(body) {
    background: var(--of-canvas);
  }

  .visual-shell {
    min-height: 100vh;
    box-sizing: border-box;
    padding: var(--of-space8);
    color: var(--of-text);
    background:
      linear-gradient(var(--of-border) 1px, transparent 1px),
      linear-gradient(90deg, var(--of-border) 1px, transparent 1px),
      var(--of-canvas);
    background-size: 32px 32px;
    font-family: var(--of-font-sans);
  }

  .visual-workspace {
    max-width: 980px;
    margin: 0 auto;
    padding: var(--of-space7);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-shell);
    background: var(--of-surface);
    box-shadow: var(--of-shadow-surface);
  }

  .visual-eyebrow {
    margin: 0 0 var(--of-space2);
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }

  .visual-workspace h1,
  h2,
  p {
    margin: 0;
  }

  .visual-grid {
    display: grid;
    grid-template-columns: 1fr 1.6fr 0.8fr;
    gap: var(--of-space4);
    min-height: 420px;
    margin-top: var(--of-space6);
  }

  .visual-grid div {
    border: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface-subtle);
  }

  .dialog-content,
  .confirmation-content {
    display: flex;
    flex-direction: column;
    gap: var(--of-space4);
    padding: var(--of-space5);
  }

  .dialog-intro,
  .confirmation-content p {
    color: var(--of-text-secondary);
    font-size: var(--of-text-sm);
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    border: var(--of-border-width) solid var(--of-border);
  }

  .settings-list label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--of-space4);
    min-height: var(--of-control-height-touch);
    padding: var(--of-space3) var(--of-space4);
    border-bottom: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface);
  }

  .settings-list label:last-child {
    border-bottom: 0;
  }

  .settings-list span {
    display: flex;
    flex-direction: column;
    gap: var(--of-space1);
  }

  .settings-list strong {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
  }

  .settings-list small {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--of-space2);
  }
</style>
