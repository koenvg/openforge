<script lang="ts">
  import { CircleCheck, CircleDashed, CircleX, Clock5, ScanSearch, Send, TriangleAlert } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  export type StatusBadgeStatus = 'pending' | 'failed' | 'success' | 'in-progress' | 'in-review' | 'submitted' | 'expired'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    children: Snippet
    status: StatusBadgeStatus
  }

  const statusIcons = {
    pending: TriangleAlert,
    failed: CircleX,
    success: CircleCheck,
    'in-progress': CircleDashed,
    'in-review': ScanSearch,
    submitted: Send,
    expired: Clock5,
  } as const

  let {
    children,
    status,
    class: className,
    ...attributes
  }: Props = $props()

  let StatusIcon = $derived(statusIcons[status])
  let isProgress = $derived(status === 'in-progress')
</script>

<span {...attributes} class={className} data-status-badge data-status={status}>
  <StatusIcon
    class="status-badge-icon {isProgress ? 'status-badge-icon--spinning motion-reduce:animate-none' : ''}"
    data-status-icon={status}
    size={14}
    strokeWidth={2.25}
    aria-hidden="true"
  />
  {@render children()}
</span>

<style>
  span {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    gap: var(--of-space3);
    padding: var(--of-space3) var(--of-space5);
    border-radius: var(--of-radius-round);
    background: var(--status-badge-background);
    box-shadow: inset 0 0 0 1px var(--status-badge-ring);
    color: var(--status-badge-foreground);
    font-family: var(--of-font-sans);
    font-size: 13px;
    font-weight: var(--of-weight-medium);
    line-height: 1;
    white-space: nowrap;
    user-select: none;
  }

  /* Palette values mirror Spectrum UI's documented status-badge source. */
  span[data-status='pending'] {
    --status-badge-background: #fffbeb;
    --status-badge-foreground: #b45309;
    --status-badge-ring: rgb(217 119 6 / 20%);
  }

  span[data-status='failed'] {
    --status-badge-background: #fff1f2;
    --status-badge-foreground: #be123c;
    --status-badge-ring: rgb(225 29 72 / 20%);
  }

  span[data-status='success'] {
    --status-badge-background: #ecfdf5;
    --status-badge-foreground: #047857;
    --status-badge-ring: rgb(5 150 105 / 20%);
  }

  span[data-status='in-progress'] {
    --status-badge-background: #f0f9ff;
    --status-badge-foreground: #0369a1;
    --status-badge-ring: rgb(2 132 199 / 20%);
  }

  span[data-status='in-review'] {
    --status-badge-background: #f5f3ff;
    --status-badge-foreground: #6d28d9;
    --status-badge-ring: rgb(124 58 237 / 20%);
  }

  span[data-status='submitted'] {
    --status-badge-background: #eef2ff;
    --status-badge-foreground: #4338ca;
    --status-badge-ring: rgb(79 70 229 / 20%);
  }

  span[data-status='expired'] {
    --status-badge-background: #f5f5f5;
    --status-badge-foreground: #525252;
    --status-badge-ring: rgb(115 115 115 / 20%);
  }

  :global(.status-badge-icon--spinning) {
    animation: status-badge-spin 3s linear infinite;
  }

  @keyframes status-badge-spin {
    to {
      transform: rotate(360deg);
    }
  }

  :global([data-theme-appearance='dark']) span[data-status='pending'],
  :global([data-theme='openforge-dark']) span[data-status='pending'] {
    --status-badge-background: rgb(251 191 36 / 10%);
    --status-badge-foreground: #fcd34d;
    --status-badge-ring: rgb(252 211 77 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='failed'],
  :global([data-theme='openforge-dark']) span[data-status='failed'] {
    --status-badge-background: rgb(251 113 133 / 10%);
    --status-badge-foreground: #fda4af;
    --status-badge-ring: rgb(253 164 175 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='success'],
  :global([data-theme='openforge-dark']) span[data-status='success'] {
    --status-badge-background: rgb(52 211 153 / 10%);
    --status-badge-foreground: #6ee7b7;
    --status-badge-ring: rgb(110 231 183 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='in-progress'],
  :global([data-theme='openforge-dark']) span[data-status='in-progress'] {
    --status-badge-background: rgb(56 189 248 / 10%);
    --status-badge-foreground: #7dd3fc;
    --status-badge-ring: rgb(125 211 252 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='in-review'],
  :global([data-theme='openforge-dark']) span[data-status='in-review'] {
    --status-badge-background: rgb(167 139 250 / 10%);
    --status-badge-foreground: #c4b5fd;
    --status-badge-ring: rgb(196 181 253 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='submitted'],
  :global([data-theme='openforge-dark']) span[data-status='submitted'] {
    --status-badge-background: rgb(129 140 248 / 10%);
    --status-badge-foreground: #a5b4fc;
    --status-badge-ring: rgb(165 180 252 / 25%);
  }

  :global([data-theme-appearance='dark']) span[data-status='expired'],
  :global([data-theme='openforge-dark']) span[data-status='expired'] {
    --status-badge-background: rgb(163 163 163 / 10%);
    --status-badge-foreground: #d4d4d4;
    --status-badge-ring: rgb(212 212 212 / 20%);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.status-badge-icon--spinning) {
      animation: none;
    }
  }
</style>
