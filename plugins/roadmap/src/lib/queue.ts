/**
 * Step circularly through a frozen queue of issue numbers.
 *
 * The queue is snapshotted when the drawer opens, but the board stays live — an entry can name
 * an issue that has since left the board (closed from the drawer, or gone after a refresh), so
 * those are skipped rather than landing on a blank drawer. `present` is the live board's set.
 *
 * Returns `index` itself when the current issue is the only survivor, and null when nothing in
 * the queue remains — the caller's cue that there is nothing left to review.
 */
export function stepIndex(
  issueNumbers: number[],
  index: number,
  dir: 1 | -1,
  present: ReadonlySet<number>,
): number | null {
  const n = issueNumbers.length
  for (let k = 1; k <= n; k++) {
    // The double modulo keeps the result non-negative when dir is -1.
    const i = (((index + dir * k) % n) + n) % n
    if (present.has(issueNumbers[i])) return i
  }
  return null
}
