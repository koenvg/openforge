<script lang="ts">
  import type { Task } from '../lib/types'
  import type { CreatureState, CreatureRoom } from '../lib/creatureState'

  interface Props {
    task: Task
    state: CreatureState
    room: CreatureRoom
    questionText: string | null
    onClick: (taskId: string) => void
    onHover: (taskId: string, rect: DOMRect) => void
    onHoverEnd: () => void
  }

  let { task, state, room, questionText, onClick, onHover, onHoverEnd }: Props = $props()

  let buttonEl: HTMLButtonElement

  let statusLabel = $derived(
    state === 'active' ? 'RUNNING' :
    state === 'needs-input' ? 'BLOCKED' :
    state === 'resting' ? 'PAUSED' :
    state === 'sad' ? 'FAILED' :
    state === 'frozen' ? 'INTERRUPTED' :
    state === 'celebrating' ? 'DONE' :
    state === 'idle' ? 'IDLE' :
    ''
  )

  let roomColor = $derived(
    state === 'celebrating' ? 'text-info' :
    room === 'forge' ? 'text-success' :
    room === 'warRoom' ? 'text-warning' :
    'text-base-content/40'
  )

  let animClass = $derived(
    room === 'nursery' ? 'creature-sleep' :
    state === 'active' ? 'creature-work' :
    state === 'needs-input' || state === 'sad' || state === 'frozen' ? 'creature-alert' :
    state === 'celebrating' ? 'creature-celebrate' :
    state === 'resting' ? 'creature-sleep' :
    ''
  )

  let thoughtBorderClass = $derived(
    state === 'celebrating' ? 'border-info/50' :
    room === 'forge' ? 'border-success/50' :
    room === 'warRoom' ? 'border-warning/50' :
    'border-base-content/20'
  )

  let thoughtTextClass = $derived(
    room === 'nursery' ? 'text-base-content/40 italic' : 'text-base-content/80'
  )

  let truncatedTitle = $derived(
    task.title.length > 30 ? task.title.slice(0, 30) + '...' : task.title
  )

  // Hash task ID to a hue rotation for subtle color variation per creature
  // Constrained to ±25° so creatures stay within their color family (green/blue)
  let hueRotation = $derived(() => {
    let hash = 0
    for (let i = 0; i < task.id.length; i++) {
      hash = ((hash << 5) - hash + task.id.charCodeAt(i)) | 0
    }
    return (Math.abs(hash) % 50) - 25
  })
</script>

<button
  bind:this={buttonEl}
  class="flex flex-col items-center gap-1 cursor-pointer relative"
  title={questionText ?? undefined}
  onclick={() => onClick(task.id)}
  onmouseenter={() => onHover(task.id, buttonEl.getBoundingClientRect())}
  onmouseleave={() => onHoverEnd()}
>
  <!-- Thought bubble -->
  <div class="bg-base-200 border {thoughtBorderClass} rounded-lg px-2 py-1 text-xs max-w-[130px] text-left mb-1">
    <span class={thoughtTextClass}>{truncatedTitle}</span>
  </div>

  {#if room !== 'nursery'}
    <svg
      viewBox="0 0 140 120"
      class="w-28 h-24 {roomColor} {animClass}"
      style={room === 'forge' ? `filter: hue-rotate(${hueRotation()}deg)` : ''}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="creature"
    >
      <g data-testid="pixel-char">
        <rect data-testid="head" x="50" y="4" width="40" height="40" rx="4" fill="currentColor" stroke="black" stroke-opacity="0.35" stroke-width="3" />
        <rect x="58" y="16" width="6" height="6" rx="1" fill="white" />
        <rect x="76" y="16" width="6" height="6" rx="1" fill="white" />
        <rect x="60" y="19" width="3" height="3" fill="black" opacity="0.85" />
        <rect x="78" y="19" width="3" height="3" fill="black" opacity="0.85" />
        {#if room === 'warRoom'}
          <rect data-testid="brow-l" x="56" y="10" width="10" height="3" fill="black" opacity="0.4" transform="rotate(-10 61 11.5)" />
          <rect data-testid="brow-r" x="74" y="10" width="10" height="3" fill="black" opacity="0.4" transform="rotate(10 79 11.5)" />
          <rect data-testid="frown" x="62" y="34" width="16" height="3" rx="1" fill="black" opacity="0.4" />
        {:else}
          <rect data-testid="mouth" x="64" y="34" width="12" height="4" rx="1" fill="black" opacity="0.3" />
        {/if}
        <rect data-testid="body" x="45" y="46" width="50" height="32" rx="2" fill="currentColor" opacity="0.85" stroke="black" stroke-opacity="0.35" stroke-width="2" />
        <rect data-testid="leg-l" x="52" y="80" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
        <rect data-testid="leg-r" x="76" y="80" width="12" height="16" rx="1" fill="currentColor" opacity="0.7" />
      </g>

      {#if room === 'warRoom'}
        <g data-testid="alert-badge">
          <rect x="98" y="0" width="20" height="20" rx="3" class="fill-error" />
          <text x="108" y="15" text-anchor="middle" fill="white" font-size="12" font-weight="bold">!</text>
        </g>
      {/if}
    </svg>

    {#if statusLabel}
      <div class="flex items-center gap-1">
        <span class="text-[9px] {roomColor}">●</span>
        <span class="font-mono text-[9px] {roomColor}">{statusLabel}</span>
      </div>
    {/if}

  {:else}
    <svg
      viewBox="0 0 120 100"
      class="w-28 h-24 {roomColor} {animClass}"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="nest"
    >
      <rect data-testid="bed" x="10" y="62" width="100" height="32" rx="8" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" />

      <rect x="20" y="57" width="80" height="14" rx="4" fill="currentColor" opacity="0.25" />

      <g data-testid="egg">
        <rect x="40" y="18" width="40" height="44" rx="20" fill="currentColor" opacity="0.35" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.4" />
        <line x1="42" y1="42" x2="78" y2="42" stroke="currentColor" stroke-width="2" stroke-opacity="0.25" />
      </g>
    </svg>

    <span class="font-mono text-xs {roomColor}">zzz</span>
  {/if}

  <span class="font-mono text-[9px] {roomColor}">{task.id}</span>
  {#if task.jira_assignee}
    <span class="font-mono text-[8px] text-base-content/40 truncate max-w-[100px]">{task.jira_assignee}</span>
  {/if}
</button>
