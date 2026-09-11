<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'children' | 'size' | 'type'> {
    label: string
    /** Keep the accessible name when the caller renders the visible caption. */
    hideLabel?: boolean
    checked?: boolean
    error?: string | null
    invalid?: boolean
    onCheckedChange?: (checked: boolean) => void
  }

  const generatedId = $props.id()
  const errorId = `of-switch-error-${generatedId}`

  let {
    label,
    hideLabel = false,
    checked = $bindable(false),
    error = null,
    invalid = false,
    disabled = false,
    id = `of-switch-${generatedId}`,
    class: className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    'aria-invalid': ariaInvalid,
    onchange,
    onCheckedChange,
    ...attributes
  }: Props = $props()

  let isInvalid = $derived(
    invalid || Boolean(error) || ariaInvalid === true || ariaInvalid === 'true',
  )
  let describedBy = $derived(
    [ariaDescribedby, error ? errorId : null].filter(Boolean).join(' ') || undefined,
  )

  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)')
  const TRACK_PADDING = 2
  const STRETCH_FACTOR = 1.35
  const DRAG_START_DISTANCE = 3
  const FLICK_VELOCITY = 250
  const VELOCITY_SAMPLE_COUNT = 5
  const SNAPPY_SPRING = { stiffness: 500, damping: 30 } as const
  const DEFAULT_TRACK_WIDTH = 49
  const DEFAULT_TRACK_HEIGHT = 28
  const DEFAULT_TRACK_INSET = 3
  const DEFAULT_KNOB_SIZE = DEFAULT_TRACK_HEIGHT - DEFAULT_TRACK_INSET * 2
  const DEFAULT_INNER_WIDTH = DEFAULT_TRACK_WIDTH - DEFAULT_TRACK_INSET * 2

  interface PointerSample {
    x: number
    t: number
  }

  interface GestureState {
    pointerId: number
    originClientX: number
    originKnobX: number
    dragging: boolean
    samples: PointerSample[]
  }

  let track = $state<HTMLSpanElement | null>(null)
  let trackInset = $state(DEFAULT_TRACK_INSET)
  let knobSize = $state(DEFAULT_KNOB_SIZE)
  let innerWidth = $state(DEFAULT_INNER_WIDTH)
  let pressed = $state(false)
  let dragging = $state(false)
  let dragX = $state<number | null>(null)
  let visualKnobX = $state(checked ? DEFAULT_INNER_WIDTH - DEFAULT_KNOB_SIZE : 0)
  let visualKnobWidth = $state(DEFAULT_KNOB_SIZE)
  let gesture: GestureState | null = null
  let suppressClick = false
  let animationFrame: number | null = null
  let animationVelocityX = 0
  let animationVelocityWidth = 0

  let stretchedWidth = $derived(Math.round(knobSize * STRETCH_FACTOR))
  let activeKnobWidth = $derived(
    pressed && !reducedMotion.current ? stretchedWidth : knobSize,
  )
  let maxKnobX = $derived(Math.max(innerWidth - activeKnobWidth, 0))
  let activeKnobX = $derived(
    dragX !== null
      ? clamp(dragX, 0, maxKnobX)
      : checked
        ? maxKnobX
        : 0,
  )
  let knobStyle = $derived(
    `top:50%;left:${trackInset}px;width:${visualKnobWidth}px;height:${knobSize}px;transform:translate3d(${visualKnobX}px,-50%,0)`,
  )

  $effect(() => {
    const targetX = activeKnobX
    const targetWidth = activeKnobWidth
    const isDragging = dragging
    const shouldReduceMotion = reducedMotion.current

    untrack(() => {
      if (isDragging) {
        cancelKnobAnimation()
        visualKnobX = targetX
        visualKnobWidth = targetWidth
        return
      }

      animateKnob(targetX, targetWidth, shouldReduceMotion)
    })
  })

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  function parsePixels(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function cancelKnobAnimation(): void {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
  }

  function animateKnob(targetX: number, targetWidth: number, instant: boolean): void {
    cancelKnobAnimation()

    if (
      instant ||
      (Math.abs(visualKnobX - targetX) < 0.01 &&
        Math.abs(visualKnobWidth - targetWidth) < 0.01 &&
        Math.abs(animationVelocityX) < 0.01 &&
        Math.abs(animationVelocityWidth) < 0.01)
    ) {
      visualKnobX = targetX
      visualKnobWidth = targetWidth
      animationVelocityX = 0
      animationVelocityWidth = 0
      return
    }

    let currentX = visualKnobX
    let currentWidth = visualKnobWidth
    let velocityX = animationVelocityX
    let velocityWidth = animationVelocityWidth
    let previousTime = performance.now()

    const step = (now: number): void => {
      const delta = Math.min((now - previousTime) / 1000, 0.02)
      previousTime = now

      velocityX +=
        ((targetX - currentX) * SNAPPY_SPRING.stiffness - velocityX * SNAPPY_SPRING.damping) * delta
      velocityWidth +=
        ((targetWidth - currentWidth) * SNAPPY_SPRING.stiffness - velocityWidth * SNAPPY_SPRING.damping) * delta
      currentX += velocityX * delta
      currentWidth += velocityWidth * delta
      animationVelocityX = velocityX
      animationVelocityWidth = velocityWidth
      visualKnobX = currentX
      visualKnobWidth = currentWidth

      const settled =
        Math.abs(targetX - currentX) < 0.01 &&
        Math.abs(targetWidth - currentWidth) < 0.01 &&
        Math.abs(velocityX) < 0.01 &&
        Math.abs(velocityWidth) < 0.01
      if (settled) {
        visualKnobX = targetX
        visualKnobWidth = targetWidth
        animationVelocityX = 0
        animationVelocityWidth = 0
        animationFrame = null
        return
      }

      animationFrame = requestAnimationFrame(step)
    }

    animationFrame = requestAnimationFrame(step)
  }

  function measureTrack(): void {
    if (!track) return

    const rect = track.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      trackInset = DEFAULT_TRACK_INSET
      knobSize = DEFAULT_KNOB_SIZE
      innerWidth = DEFAULT_INNER_WIDTH
      return
    }

    const styles = getComputedStyle(track)
    const border = parsePixels(styles.borderLeftWidth, 1) || 1
    const padding = parsePixels(styles.paddingLeft, TRACK_PADDING) || TRACK_PADDING
    const inset = border + padding

    trackInset = inset
    knobSize = Math.max(rect.height - inset * 2, 0)
    innerWidth = Math.max(rect.width - inset * 2, 0)
  }

  onMount(measureTrack)
  onDestroy(cancelKnobAnimation)

  function setChecked(next: boolean): void {
    if (next === checked) return
    checked = next
    onCheckedChange?.(next)
  }

  function handleTrackClick(event: MouseEvent): void {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disabled || !event.isPrimary) return

    measureTrack()
    suppressClick = false
    const width = reducedMotion.current ? knobSize : stretchedWidth
    gesture = {
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originKnobX: checked ? innerWidth - width : 0,
      dragging: false,
      samples: [{ x: event.clientX, t: event.timeStamp }],
    }
    track?.setPointerCapture?.(event.pointerId)
    pressed = true
    dragging = false
    dragX = null
  }

  function handlePointerMove(event: PointerEvent): void {
    const state = gesture
    if (!state || event.pointerId !== state.pointerId) return

    state.samples.push({ x: event.clientX, t: event.timeStamp })
    if (state.samples.length > VELOCITY_SAMPLE_COUNT) state.samples.shift()

    const deltaX = event.clientX - state.originClientX
    if (!state.dragging && Math.abs(deltaX) < DRAG_START_DISTANCE) return

    state.dragging = true
    dragging = true
    const width = reducedMotion.current ? knobSize : stretchedWidth
    dragX = clamp(state.originKnobX + deltaX, 0, innerWidth - width)
  }

  function endGesture(event: PointerEvent): void {
    gesture = null
    if (track?.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId)
    pressed = false
    dragging = false
    dragX = null
  }

  function handlePointerUp(event: PointerEvent): void {
    const state = gesture
    if (!state || event.pointerId !== state.pointerId) return

    if (state.dragging) {
      suppressClick = true
      const width = reducedMotion.current ? knobSize : stretchedWidth
      const knobEnd = clamp(
        state.originKnobX + (event.clientX - state.originClientX),
        0,
        innerWidth - width,
      )
      const oldest = state.samples[0]
      const elapsed = event.timeStamp - oldest.t
      const velocity = elapsed > 0 ? ((event.clientX - oldest.x) / elapsed) * 1000 : 0
      const next =
        Math.abs(velocity) >= FLICK_VELOCITY
          ? velocity > 0
          : knobEnd + width / 2 > innerWidth / 2

      setChecked(next)
    }

    endGesture(event)
  }
</script>

<div class="of-switch">
  <label for={id}>
    <input
      {...attributes}
      {id}
      class={className}
      type="checkbox"
      role="switch"
      {checked}
      {disabled}
      aria-label={hideLabel ? label : ariaLabel}
    aria-describedby={describedBy}
      aria-invalid={isInvalid ? 'true' : ariaInvalid}
      onchange={(event) => {
        checked = event.currentTarget.checked
        onchange?.(event)
        onCheckedChange?.(checked)
      }}
    />
    <span
      bind:this={track}
      class="of-switch-track"
      aria-hidden="true"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={endGesture}
      onclick={handleTrackClick}
    >
      <span class="of-switch-knob" style={knobStyle}></span>
    </span>
    {#if !hideLabel}<span class="of-switch-label">{label}</span>{/if}
  </label>
  {#if error}
    <span id={errorId} class="of-switch-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .of-switch {
    display: grid;
    gap: var(--of-space2);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: var(--of-space2);
    width: fit-content;
    cursor: pointer;
  }

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
  }

  .of-switch-track {
    position: relative;
    box-sizing: border-box;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    width: calc(var(--of-control-height-compact) * 1.75);
    height: var(--of-control-height-compact);
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-round);
    background: var(--of-control);
    touch-action: none;
    user-select: none;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-switch-knob {
    position: absolute;
    box-sizing: border-box;
    flex-shrink: 0;
    border-radius: var(--of-radius-round);
    background: var(--of-control-text);
    pointer-events: none;
    will-change: transform, width;
  }

  input:checked + .of-switch-track {
    border-color: var(--of-accent);
    background: var(--of-accent);
  }

  input:checked + .of-switch-track .of-switch-knob {
    background: var(--of-on-accent);
  }

  input:focus-visible + .of-switch-track {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  input[aria-invalid='true'] + .of-switch-track {
    border-color: var(--of-danger);
  }

  input:disabled + .of-switch-track {
    background: var(--of-control-disabled);
  }

  input:disabled ~ .of-switch-label {
    color: var(--of-control-text-disabled);
  }

  label:has(input:disabled) {
    cursor: not-allowed;
  }

  .of-switch-label {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .of-switch-error {
    color: var(--of-danger);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .of-switch-track {
      transition: none;
    }
  }
</style>
