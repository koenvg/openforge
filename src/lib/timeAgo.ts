/**
 * Format a timestamp as a human-readable relative time string.
 * @param timestampMs Unix timestamp in milliseconds (Date.now() format)
 */
export function timeAgo(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Format a Unix timestamp in seconds as a human-readable relative time string.
 * @param timestampSeconds Unix timestamp in seconds
 */
export function timeAgoFromSeconds(timestampSeconds: number): string {
  return timeAgo(timestampSeconds * 1000)
}
