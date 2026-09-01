/** A ticket-coverage finding the reviewer chose to fold into their review. */
export interface IncludedFinding {
  id: string
  label: string
  text: string
}

/**
 * Composes the final review body from findings the reviewer flagged plus
 * whatever they typed themselves. Findings render as a bullet list ahead of
 * the typed summary so they read as context, not a replacement for it.
 */
export function composeReviewBody(findings: IncludedFinding[], summary: string): string {
  const trimmedSummary = summary.trim()
  if (findings.length === 0) return trimmedSummary

  const bulletList = findings.map((finding) => `- **${finding.label}**: ${finding.text}`).join('\n')
  const block = `Ticket coverage gaps:\n${bulletList}`
  return trimmedSummary ? `${block}\n\n${trimmedSummary}` : block
}
