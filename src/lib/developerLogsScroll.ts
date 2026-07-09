/**
 * Whether a scrollable log view is close enough to the bottom that it should
 * keep auto-scrolling as new entries arrive.
 *
 * Pure decision helper for the "stick to bottom unless the user scrolled up"
 * pattern: while this returns true we pin the view to the newest entry; once
 * the user scrolls up past `threshold` it returns false and auto-scroll pauses
 * until they scroll back down.
 *
 * @param scrollTop     Current vertical scroll offset of the container.
 * @param scrollHeight  Total scrollable content height.
 * @param clientHeight  Visible viewport height of the container.
 * @param threshold     Grace distance from the bottom, in pixels, that still
 *                      counts as "pinned" (absorbs sub-pixel rounding and lets
 *                      the user sit at the bottom without being pixel-perfect).
 */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight
  return distanceFromBottom <= threshold
}
