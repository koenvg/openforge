/**
 * Resolving which Jira ticket a pull request implements.
 *
 * The PR is the outcome of a ticket, but GitHub has no link back to it, so the
 * key has to be recovered from what the author wrote: the branch name, the
 * title, or the body — in that order, first match wins. A reviewer-supplied
 * override beats all of them.
 */

/** The PR fields key detection reads. Structural so tests need no full fixture. */
export interface JiraKeySource {
  head_ref: string
  title: string
  body: string | null
}

/**
 * Uppercase-only by default. Lowercasing the pattern would match half the words
 * in a branch name, so a lowercase key is only accepted when the project keys
 * are configured and can vouch for it.
 */
const STRICT_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g

/**
 * Tokens that look exactly like a Jira key but never are. Without configured
 * project keys these are the difference between "AVIV-304" and a PR titled
 * "Fix UTF-8 handling" claiming to implement ticket UTF-8.
 */
const NOT_TICKET_KEYS = new Set([
  'UTF', 'ISO', 'RFC', 'SHA', 'MD5', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'UTC',
  'IPV', 'CVE', 'ASCII', 'API', 'SQL', 'AWS', 'GCP', 'X86', 'ARM', 'EOL',
  'ES', 'TS', 'JS', 'CSS', 'HTML', 'PR', 'CI', 'UI', 'UX', 'AC',
])

/**
 * Case-insensitive variant, used only when configured project keys can confirm
 * the prefix — branch names are routinely lowercased by tooling.
 */
const LOOSE_KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b/g

export function parseProjectKeys(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(key => key.trim().toUpperCase())
    .filter(key => key.length > 0)
}

export function resolveJiraKey(
  source: JiraKeySource,
  projectKeys: string[],
  override?: string | null,
): string | null {
  const trimmedOverride = override?.trim()
  if (trimmedOverride) return trimmedOverride.toUpperCase()

  // Branch, then title, then body: the branch is the least likely to merely
  // *mention* an unrelated ticket.
  for (const field of [source.head_ref, source.title, source.body ?? '']) {
    const key = findKey(field, projectKeys)
    if (key) return key
  }
  return null
}

function findKey(text: string, projectKeys: string[]): string | null {
  if (!text) return null

  if (projectKeys.length > 0) {
    for (const [, prefix, number] of text.matchAll(LOOSE_KEY_PATTERN)) {
      const upper = prefix.toUpperCase()
      if (projectKeys.includes(upper)) return `${upper}-${number}`
    }
    return null
  }

  for (const [, prefix, number] of text.matchAll(STRICT_KEY_PATTERN)) {
    if (NOT_TICKET_KEYS.has(prefix)) continue
    return `${prefix}-${number}`
  }
  return null
}
