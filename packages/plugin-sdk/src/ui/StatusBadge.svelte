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

  span[data-status='pending'] {
    --status-badge-background: var(--of-status-warning-subtle);
    --status-badge-foreground: var(--of-on-status-warning);
    --status-badge-ring: var(--of-status-warning);
  }

  span[data-status='failed'] {
    --status-badge-background: var(--of-status-danger-subtle);
    --status-badge-foreground: var(--of-on-status-danger);
    --status-badge-ring: var(--of-status-danger);
  }

  span[data-status='success'] {
    --status-badge-background: var(--of-status-success-subtle);
    --status-badge-foreground: var(--of-on-status-success);
    --status-badge-ring: var(--of-status-success);
  }

  span[data-status='in-progress'] {
    --status-badge-background: var(--of-status-running-subtle);
    --status-badge-foreground: var(--of-on-status-running);
    --status-badge-ring: var(--of-status-running);
  }

  span[data-status='in-review'],
  span[data-status='submitted'] {
    --status-badge-background: var(--of-status-waiting-subtle);
    --status-badge-foreground: var(--of-on-status-waiting);
    --status-badge-ring: var(--of-status-waiting);
  }

  span[data-status='expired'] {
    --status-badge-background: var(--of-status-neutral-subtle);
    --status-badge-foreground: var(--of-on-status-neutral);
    --status-badge-ring: var(--of-status-neutral);
  }

  :global(.status-badge-icon--spinning) {
    animation: status-badge-spin 3s linear infinite;
  }

  @keyframes status-badge-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.status-badge-icon--spinning) {
      animation: none;
    }
  }
</style>
