import type { Readable } from 'svelte/store'

/**
 * Decide which row the cursor should land on after the attention overview refreshes.
 *
 * The list can grow/shrink under the user while the dialog is open, so a raw index
 * would drift. We prefer the *same logical row* (`previousKey`) so the cursor stays
 * put; if that row is gone we clamp the previous index into the new range instead of
 * jumping to the top.
 */
export function resolveFocusedIndex(
  previousKey: string | null,
  nextRowKeys: readonly string[],
  previousIndex: number,
): number {
  if (previousKey !== null) {
    const idx = nextRowKeys.indexOf(previousKey)
    if (idx >= 0) return idx
  }
  if (nextRowKeys.length === 0) return 0
  return Math.min(Math.max(previousIndex, 0), nextRowKeys.length - 1)
}

/**
 * Subscribe to a set of stores and invoke `onChange` (debounced by `delayMs`) whenever
 * any of them changes *after* the initial subscription. Svelte stores emit their current
 * value synchronously on subscribe; those initial emissions are ignored so `onChange`
 * fires only on genuine subsequent changes. A burst of changes coalesces into one call.
 *
 * Returns a teardown that unsubscribes from every store and cancels any pending call.
 */
export function subscribeDebounced(
  stores: readonly Readable<unknown>[],
  onChange: () => void,
  delayMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let ready = false

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, delayMs)
  }

  // Each subscribe() calls back synchronously with the current value; because `ready`
  // is still false during this loop, those priming emissions are skipped.
  const unsubscribers = stores.map((store) => store.subscribe(() => {
    if (ready) schedule()
  }))
  ready = true

  return () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
