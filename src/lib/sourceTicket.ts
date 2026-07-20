/**
 * Helpers for interpreting a task's optional "source ticket" link — the GitHub
 * issue, Jira ticket, or other URL a task originated from. Kept as pure
 * functions so the display logic (clickability + friendly label) is unit
 * testable and shared between the create dialog and the task detail panel.
 */

export interface SourceTicketLink {
  /** The normalized, trimmed value stored on the task. */
  url: string
  /** True only when the value is an http(s) URL that is safe to open externally. */
  clickable: boolean
  /** A short, human-friendly label for display. */
  label: string
}

/** Trim a raw source-ticket value; returns null when it is empty or blank. */
export function normalizeSourceTicketUrl(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Parse `value` as a URL, returning it only when it uses the http(s) scheme. */
function parseHttpUrl(value: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

function deriveLabel(url: URL): string {
  const host = stripWww(url.hostname)
  const segments = url.pathname.split('/').filter(Boolean)

  // GitHub issue / pull request: /{owner}/{repo}/(issues|pull)/{number}
  if (host === 'github.com' && segments.length >= 4) {
    const [owner, repo, kind, number] = segments
    if ((kind === 'issues' || kind === 'pull') && /^\d+$/.test(number)) {
      return `${owner}/${repo}#${number}`
    }
  }

  // Jira (and similar): /browse/{KEY-123}
  const browseIndex = segments.indexOf('browse')
  const browseKey = browseIndex === -1 ? undefined : segments[browseIndex + 1]
  if (browseKey && /^[A-Za-z][A-Za-z0-9]+-\d+$/.test(browseKey)) {
    return browseKey
  }

  return host
}

/**
 * Resolve a stored source-ticket value into display metadata, or null when the
 * task has no source ticket. http(s) URLs are clickable and get a friendly
 * label; any other value is shown as non-clickable plain text.
 */
export function getSourceTicketLink(value: string | null | undefined): SourceTicketLink | null {
  const normalized = normalizeSourceTicketUrl(value)
  if (normalized == null) return null

  const parsed = parseHttpUrl(normalized)
  if (!parsed) {
    return { url: normalized, clickable: false, label: normalized }
  }

  return { url: normalized, clickable: true, label: deriveLabel(parsed) }
}
