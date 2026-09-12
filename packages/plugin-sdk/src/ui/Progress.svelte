<script lang="ts">
  import type { HTMLProgressAttributes } from 'svelte/elements'

  interface Props extends HTMLProgressAttributes {
    variant?: 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger'
  }

  let { variant = 'primary', value, max, children, ...attributes }: Props = $props()

  function syncRange(node: HTMLProgressElement) {
    $effect(() => {
      // Svelte spreads use DOM property setters, which ignore invalid maxima.
      // Preserve HTML attribute normalization, including omitted value, on updates.
      for (const [name, input] of [['value', value], ['max', max]] as const) {
        if (input == null) node.removeAttribute(name)
        else node.setAttribute(name, String(input))
      }
    })
  }
</script>

<progress {...attributes} {value} {max} use:syncRange data-variant={variant}>{@render children?.()}</progress>

<style>
  progress {
    box-sizing: border-box;
    appearance: none;
    display: inline-block;
    vertical-align: baseline;
    width: 100%;
    height: .5rem;
    border: 0;
    border-radius: var(--of-radius-container);
    overflow: hidden;
    color: var(--of-accent);
    background: color-mix(in oklab, currentColor 20%, transparent);
  }
  progress[data-variant='neutral'] { color: var(--of-text); }
  progress[data-variant='info'] { color: var(--of-info); }
  progress[data-variant='success'] { color: var(--of-success); }
  progress[data-variant='warning'] { color: var(--of-warning); }
  progress[data-variant='danger'] { color: var(--of-danger); }
  progress::-webkit-progress-bar { background: transparent; border-radius: inherit; }
  progress::-webkit-progress-value { background: currentColor; border-radius: inherit; }
  progress::-moz-progress-bar { background: currentColor; border-radius: inherit; }
  progress:indeterminate {
    background-image: linear-gradient(currentColor, currentColor);
    background-repeat: no-repeat;
    background-size: 40% 100%;
    animation: pending 1.5s ease-in-out infinite alternate;
  }
  progress:indeterminate::-moz-progress-bar { background: transparent; }
  @keyframes pending { from { background-position: 0% 0; } to { background-position: 100% 0; } }
  @media (prefers-reduced-motion: reduce) {
    progress:indeterminate { animation: none; background-position: 50% 0; }
  }
  @media (forced-colors: active) { progress { appearance: auto; } }
</style>
