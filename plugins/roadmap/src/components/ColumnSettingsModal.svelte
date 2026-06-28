<script lang="ts">
  import type { LabelUsage } from '../lib/types'
  import ColorPicker from './ColorPicker.svelte'

  interface Props {
    repo: string
    labels: LabelUsage[]
    initialColumnLabels: string[]
    busy: boolean
    onClose: () => void
    onSave: (labels: string[]) => void
    onRecolor: (name: string, color: string) => Promise<void>
  }

  let { repo, labels, initialColumnLabels, busy, onClose, onSave, onRecolor }: Props = $props()

  // Seed editable local order from the initial prop; the modal re-mounts per open.
  // svelte-ignore state_referenced_locally
  let selected = $state<string[]>([...initialColumnLabels])
  // Seed editable labels so color changes can update/revert locally while the
  // GitHub label update runs.
  // svelte-ignore state_referenced_locally
  let editableLabels = $state<LabelUsage[]>(labels.map((label) => ({ ...label })))
  let openColorName = $state<string | null>(null)
  let colorBusyName = $state<string | null>(null)

  let available = $derived(editableLabels.filter((l) => !selected.includes(l.name)))

  const HEX6 = /^[0-9a-fA-F]{6}$/
  function colorOf(name: string): string | null {
    return editableLabels.find((l) => l.name === name)?.color ?? null
  }
  function swatchStyle(color: string | null): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color};`
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= selected.length) return
    const next = selected.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    selected = next
  }
  function remove(name: string) {
    selected = selected.filter((x) => x !== name)
  }
  function add(name: string) {
    selected = [...selected, name]
  }

  async function recolor(name: string, color: string) {
    openColorName = null
    colorBusyName = name
    const previous = editableLabels
    editableLabels = editableLabels.map((label) => (label.name === name ? { ...label, color } : label))
    try {
      await onRecolor(name, color)
    } catch {
      editableLabels = previous
    } finally {
      colorBusyName = null
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="modal-box bg-base-100 max-w-lg p-0 flex flex-col max-h-[90vh]">
    <div class="flex items-center justify-between px-5 py-3 border-b border-base-300 shrink-0">
      <h3 class="text-base font-semibold m-0">Columns for {repo}</h3>
      <button class="btn btn-ghost btn-sm btn-square" type="button" aria-label="Close" onclick={onClose}>✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      <p class="text-sm text-base-content/60 m-0">
        Active columns appear left → right (then “No label / Other”). Use ↑ / ↓ to set which comes first.
      </p>

      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Active columns</span>
        {#if selected.length === 0}
          <p class="text-sm text-base-content/40 m-0">No columns yet — add some below.</p>
        {/if}
        <div class="flex flex-col gap-1.5">
          {#each selected as name, i (name)}
            <div class="flex items-center gap-2 rounded-box border border-base-300 px-2 py-1.5">
              <span class="text-xs text-base-content/40 w-5 text-center">{i + 1}</span>
              <span class="relative inline-flex shrink-0">
                <button
                  type="button"
                  class="h-3.5 w-3.5 rounded-md border border-base-content/20 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  style={swatchStyle(colorOf(name))}
                  aria-label={`Change color of ${name}`}
                  title={`Change "${name}" color`}
                  disabled={busy || colorBusyName !== null}
                  onclick={() => (openColorName = openColorName === name ? null : name)}
                ></button>
                {#if openColorName === name}
                  <ColorPicker
                    current={colorOf(name)}
                    onPick={(color) => recolor(name, color)}
                    onClose={() => (openColorName = null)}
                  />
                {/if}
              </span>
              <span class="text-sm flex-1 truncate">{name}</span>
              <div class="flex items-center gap-1">
                <button class="btn btn-ghost btn-xs btn-square" disabled={i === 0} aria-label={`Move ${name} up`} onclick={() => move(i, -1)}>↑</button>
                <button class="btn btn-ghost btn-xs btn-square" disabled={i === selected.length - 1} aria-label={`Move ${name} down`} onclick={() => move(i, 1)}>↓</button>
                <button class="btn btn-ghost btn-xs btn-square text-error" aria-label={`Remove ${name}`} onclick={() => remove(name)}>✕</button>
              </div>
            </div>
          {/each}
        </div>
      </div>

      {#if available.length > 0}
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Add a column</span>
          <div class="flex flex-wrap gap-2">
            {#each available as label (label.name)}
              <button
                type="button"
                class="badge badge-lg gap-1 cursor-pointer {label.used ? 'badge-outline' : 'badge-ghost opacity-60'}"
                onclick={() => add(label.name)}
              >
                {#if label.color}
                  <span class="w-2.5 h-2.5 rounded-sm" style={swatchStyle(label.color)}></span>
                {/if}
                ＋ {label.name}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="flex justify-end gap-2 px-5 py-3 border-t border-base-300 shrink-0">
      <button class="btn btn-sm btn-ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <button class="btn btn-sm btn-primary" onclick={() => onSave(selected)} disabled={busy}>Save</button>
    </div>
  </div>
</div>
