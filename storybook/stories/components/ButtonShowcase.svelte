<script lang="ts">
  import { ArrowRight, Check, Download, LoaderCircle, Plus, Sparkles } from '@lucide/svelte'
  import Button from '../../../packages/plugin-sdk/src/ui/Button.svelte'
  import IconButton from '../../../packages/plugin-sdk/src/ui/IconButton.svelte'

  type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
  type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  const variants: readonly { value: ButtonVariant; label: string; description: string }[] = [
    { value: 'primary', label: 'Primary', description: 'The highest-priority action in a view.' },
    { value: 'secondary', label: 'Secondary', description: 'A contained alternative to the primary action.' },
    { value: 'outline', label: 'Outline', description: 'A quieter action with a defined boundary.' },
    { value: 'ghost', label: 'Ghost', description: 'Low-emphasis actions in toolbars and surfaces.' },
    { value: 'destructive', label: 'Destructive', description: 'Irreversible or risky actions that need intent.' },
    { value: 'link', label: 'Link', description: 'A text action that reads like a link.' },
  ]
  const sizes: readonly ButtonSize[] = ['xs', 'sm', 'md', 'lg']

  let lastAction = $state('Choose an action to see the button respond.')

  function recordAction(label: string) {
    lastAction = `${label} activated`
  }
</script>

<main class="button-showcase">
  <header class="showcase-header">
    <div>
      <p class="eyebrow">OpenForge SDK · Components</p>
      <h1>Button</h1>
      <p class="lede">A focused action system with clear hierarchy, dependable states, and room for icons.</p>
    </div>
    <div class="header-mark" aria-hidden="true"><Sparkles size={22} strokeWidth={1.8} /></div>
  </header>

  <section class="showcase-card" aria-labelledby="variants-heading">
    <div class="section-heading">
      <div>
        <p class="section-kicker">Visual language</p>
        <h2 id="variants-heading">Every variant, side by side</h2>
      </div>
      <p>Use one clear action hierarchy per surface. Icon buttons keep the same semantic treatment with a required accessible label.</p>
    </div>

    <div class="variant-table" role="list" aria-label="Button variants">
      <div class="variant-table-header" aria-hidden="true">
        <span>Variant</span>
        <span>Text</span>
        <span>With icon</span>
        <span>Icon only</span>
      </div>
      {#each variants as variant}
        <div class="variant-row" role="listitem">
          <div class="variant-meta">
            <strong>{variant.label}</strong>
            <span>{variant.description}</span>
          </div>
          <Button variant={variant.value} onclick={() => recordAction(variant.label)}>{variant.label}</Button>
          <Button variant={variant.value} onclick={() => recordAction(`${variant.label} with icon`)}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            Add item
          </Button>
          <IconButton variant={variant.value} label={`${variant.label} download`} onclick={() => recordAction(`${variant.label} icon`)}>
            <Download size={16} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      {/each}
    </div>
  </section>

  <div class="showcase-columns">
    <section class="showcase-card" aria-labelledby="sizes-heading">
      <div class="section-heading compact">
        <div>
          <p class="section-kicker">Scale</p>
          <h2 id="sizes-heading">Four useful sizes</h2>
        </div>
      </div>
      <div class="size-list">
        {#each sizes as size}
          <div class="size-row">
            <code>{size}</code>
            <Button {size} onclick={() => recordAction(`${size} button`)}>Create task</Button>
            <IconButton {size} label={`${size} add task`} onclick={() => recordAction(`${size} icon`)}>
              <Plus size={size === 'xs' ? 13 : 16} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        {/each}
      </div>
    </section>

    <section class="showcase-card" aria-labelledby="states-heading">
      <div class="section-heading compact">
        <div>
          <p class="section-kicker">Feedback</p>
          <h2 id="states-heading">States that explain themselves</h2>
        </div>
      </div>
      <div class="state-list">
        <div class="state-row">
          <span>Default</span>
          <Button onclick={() => recordAction('default')}>Save changes</Button>
        </div>
        <div class="state-row">
          <span>Disabled</span>
          <Button disabled>Save changes</Button>
        </div>
        <div class="state-row">
          <span>Loading</span>
          <Button loading loadingLabel="Saving changes">Save changes</Button>
        </div>
        <div class="state-row">
          <span>Success</span>
          <Button variant="secondary" onclick={() => recordAction('saved')}>
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            Saved
          </Button>
        </div>
      </div>
    </section>
  </div>

  <footer class="showcase-footer" aria-live="polite">
    <span class="status-dot" aria-hidden="true"></span>
    <span>{lastAction}</span>
    <ArrowRight size={15} strokeWidth={1.8} aria-hidden="true" />
    <span class="footer-note">Focus rings, disabled behavior, and reduced-motion support are built in.</span>
    <LoaderCircle class="footer-loader" size={14} strokeWidth={1.8} aria-hidden="true" />
  </footer>
</main>

<style>
  .button-showcase {
    box-sizing: border-box;
    width: min(1120px, 100%);
    margin: 0 auto;
    padding: clamp(32px, 6vw, 80px) clamp(20px, 4vw, 56px) 64px;
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .showcase-header,
  .section-heading,
  .showcase-footer,
  .variant-table-header,
  .variant-row,
  .size-row,
  .state-row {
    display: flex;
    align-items: center;
  }

  .showcase-header {
    justify-content: space-between;
    gap: var(--of-space6);
    margin-bottom: var(--of-space7);
  }

  .eyebrow,
  .section-kicker {
    margin: 0 0 var(--of-space2);
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    letter-spacing: 0.12em;
    line-height: var(--of-line-height-xs);
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: var(--of-space3);
    font-size: clamp(32px, 5vw, 48px);
    font-weight: var(--of-weight-semibold);
    letter-spacing: -0.04em;
    line-height: 1;
  }

  h2 {
    margin-bottom: 0;
    font-size: var(--of-text-lg);
    font-weight: var(--of-weight-semibold);
    letter-spacing: -0.02em;
    line-height: var(--of-line-height-lg);
  }

  .lede {
    max-width: 540px;
    margin-bottom: 0;
    color: var(--of-text-secondary);
    font-size: var(--of-text-md);
    line-height: var(--of-line-height-md);
  }

  .header-mark {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 56px;
    height: 56px;
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface-subtle);
    color: var(--of-accent);
  }

  .showcase-card {
    padding: var(--of-space6);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
    box-shadow: var(--of-shadow-surface);
  }

  .section-heading {
    justify-content: space-between;
    gap: var(--of-space6);
    margin-bottom: var(--of-space6);
  }

  .section-heading > p {
    max-width: 420px;
    margin-bottom: 0;
    color: var(--of-text-muted);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
    text-align: right;
  }

  .section-heading.compact {
    margin-bottom: var(--of-space5);
  }

  .variant-table {
    overflow: hidden;
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
  }

  .variant-table-header,
  .variant-row {
    display: grid;
    grid-template-columns: minmax(190px, 1.25fr) repeat(3, minmax(116px, 0.75fr));
    gap: var(--of-space4);
    padding: var(--of-space4) var(--of-space5);
  }

  .variant-table-header {
    color: var(--of-text-muted);
    background: var(--of-surface-subtle);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .variant-row {
    min-height: 60px;
    border-top: var(--of-border-width) solid var(--of-border);
  }

  .variant-meta {
    display: grid;
    gap: var(--of-space1);
  }

  .variant-meta strong {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-semibold);
  }

  .variant-meta span {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .showcase-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--of-space5);
    margin-top: var(--of-space5);
  }

  .size-list,
  .state-list {
    display: grid;
    gap: var(--of-space3);
  }

  .size-row,
  .state-row {
    justify-content: space-between;
    gap: var(--of-space3);
    min-height: var(--of-control-height);
  }

  .size-row + .size-row,
  .state-row + .state-row {
    padding-top: var(--of-space3);
    border-top: var(--of-border-width) solid var(--of-border);
  }

  code,
  .state-row > span:first-child {
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }

  code {
    min-width: 32px;
  }

  .size-row :global(button:first-of-type) {
    margin-left: auto;
  }

  .showcase-footer {
    flex-wrap: wrap;
    gap: var(--of-space2);
    margin-top: var(--of-space5);
    padding: var(--of-space4) var(--of-space5);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
    color: var(--of-text-secondary);
    font-size: var(--of-text-xs);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--of-radius-round);
    background: var(--of-success);
  }

  .footer-note {
    color: var(--of-text-muted);
  }

  :global(.footer-loader) {
    margin-left: auto;
    color: var(--of-text-muted);
  }

  @media (max-width: 840px) {
    .variant-table-header {
      display: none;
    }

    .variant-row {
      grid-template-columns: minmax(140px, 1fr) repeat(3, auto);
    }

    .variant-row > :global(button) {
      justify-self: end;
    }
  }

  @media (max-width: 680px) {
    .showcase-header,
    .section-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .section-heading > p {
      text-align: left;
    }

    .showcase-columns {
      grid-template-columns: 1fr;
    }

    .variant-row {
      grid-template-columns: 1fr auto auto auto;
      gap: var(--of-space2);
      padding-inline: var(--of-space3);
    }

    .variant-meta span {
      display: none;
    }

    .variant-row > :global(button) {
      padding-inline: var(--of-space2);
    }
  }
</style>
