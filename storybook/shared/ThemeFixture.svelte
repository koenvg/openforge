<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  let { catalog }: { catalog: string } = $props()
</script>

<section class="min-h-screen bg-[var(--of-canvas)] p-8 text-[var(--of-text)]" data-testid="theme-fixture">
  <div class="mx-auto max-w-xl rounded-[var(--of-radius-container)] border border-[var(--of-border)] bg-[var(--of-surface)] p-6 shadow-[var(--of-shadow-raised)]">
    <p class="font-mono text-xs uppercase tracking-[0.18em] text-[var(--of-text-muted)]">{catalog}</p>
    <h1 class="mt-2 text-xl font-semibold">OpenForge UI catalog</h1>
    <p class="mt-2 text-sm text-[var(--of-text-secondary)]">
      Production fonts, tokens, controls, and layout utilities are active.
    </p>
    <Button variant="primary" size="sm" class="mt-5">Theme ready</Button>
  </div>
</section>
