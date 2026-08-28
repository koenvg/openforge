import type { PrFileDiff, ReviewComment } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'
import type { JiraWorkItem } from './ticketCoverage'
import promptTemplate from './walkthroughPrompt.md?raw'
import defaultReviewGuidance from './reviewGuidance.md?raw'
import defaultWalkthroughGuidance from './walkthroughGuidance.md?raw'

/**
 * Built-in walkthrough + AI-review prompt template. Not user-editable: it carries
 * the `{{…}}` placeholders that feed the agent the diff and the JSON output
 * contract the parsers depend on. What users configure are the two guidance
 * slots below, which the template embeds.
 */
export const DEFAULT_WALKTHROUGH_PROMPT = promptTemplate

/**
 * Shipped default for the `pr_review_guidance` setting: what to look for and how
 * picky to be. Kept byte-identical to the core copy (`src/lib/reviewGuidance.md`)
 * via prGuidanceDefaults.test.ts, so Settings shows exactly what generation uses.
 */
export const DEFAULT_REVIEW_GUIDANCE = defaultReviewGuidance

/**
 * Shipped default for the `pr_walkthrough_guidance` setting: how to split the PR
 * into steps, including how many. Nothing else in the prompt states a target step
 * count, which is why an unguided run swings between three steps and fifteen.
 */
export const DEFAULT_WALKTHROUGH_GUIDANCE = defaultWalkthroughGuidance

export interface WalkthroughPromptInput {
  title: string
  body: string | null
  files: PrFileDiff[]
  /** Comments already on the PR (human or earlier AI), so the agent doesn't repeat them. */
  existingComments?: ReviewComment[]
  /**
   * User-configured review instructions. An empty string is a deliberate choice
   * ("no extra guidance") and drops the section; `undefined` means the caller
   * didn't specify, so the shipped default applies.
   */
  reviewGuidance?: string
  /** User-configured walkthrough guidelines. Same empty/undefined split as above. */
  walkthroughGuidance?: string
  /**
   * The Jira ticket this PR implements, when one was resolved and fetched. Its
   * presence is what turns on the gap analysis: with no ticket, neither the
   * ticket context nor the `ticket_coverage` output section is emitted, and the
   * prompt is byte-identical to what it was before this feature existed.
   */
  ticket?: JiraWorkItem | null
}

/** The ticket section: read first, because it is what the diff is judged against. */
function formatTicketSection(ticket: JiraWorkItem): string {
  const description = ticket.description.trim() || '(no description on this ticket)'
  const type = ticket.issue_type ?? 'Unknown'
  const status = ticket.status ?? 'Unknown'
  const criteria = ticket.acceptance_criteria.trim()

  // A dedicated acceptance-criteria field beats anything inferred from prose, so
  // when the ticket has one it goes first and the agent is told not to look past
  // it. Otherwise fall back to a section in the description, then to inference.
  const criteriaSection = criteria
    ? `### Acceptance Criteria

${criteria}

These acceptance criteria are the authoritative list. Judge the diff against exactly these items. \
Do not substitute your own reading of the description, and do not add criteria that are not \
listed here.

`
    : ''

  const criteriaInstruction = criteria
    ? 'Read the ticket before you analyse the diff. Work through the acceptance criteria above one \
at a time.'
    : 'Read the ticket before you analyse the diff. Enumerate every acceptance criterion it \
states, in full, before judging any of them. If the description contains an explicit \
"Acceptance Criteria" section, use exactly those items. Otherwise derive the functional \
requirements from the description and summary.'

  return `## Source Ticket

This PR implements Jira ticket ${ticket.issue_key}. The ticket is the source of truth for what \
should have been built; the diff is only an attempt at it.

**Summary:** ${ticket.summary}
**Type:** ${type}   **Status:** ${status}
**Link:** ${ticket.url}

${criteriaSection}### Ticket Description

${description}

${criteriaInstruction}

`
}

/** The `ticket_coverage` output contract. Emitted only alongside a ticket. */
function formatCoverageOutputSection(): string {
  return `In the SAME JSON object, also return \`ticket_coverage\`: your assessment of whether \
this PR implements the ticket above.

\`\`\`json
{
  "ticket_coverage": {
    "verdict": "partial",             // complete | partial | missing | unassessable
    "summary": "2–3 sentences on whether the PR delivers the ticket.",
    "criteria": [
      {
        "id": "ac-1",
        "text": "The criterion, quoted verbatim from the ticket.",
        "status": "covered",          // covered | partial | missing | unclear
        "evidence": [
          { "filename": "exact filename from the Changed Files list", "note": "Why this satisfies it." }
        ],
        "notes": "Required when status is not \\"covered\\": say what is missing."
      }
    ],
    "out_of_scope": [
      { "description": "Functional change the ticket does not ask for.", "files": ["exact filename"] }
    ]
  }
}
\`\`\`

Rules for \`ticket_coverage\`:
- List every acceptance criterion you identified, including the ones that are fully covered.
- \`evidence\` filenames must come from the Changed Files list. Do not invent them.
- Judge the diff only against the ticket. Code that is well written but implements something else
  is still \`missing\`.

Rules for \`out_of_scope\` — this list is about product behaviour, not code:
- Include only clear functional, user-observable changes that the ticket does not mention.
- Never include refactoring, renames, file moves, test additions, dependency bumps, formatting,
  type-only changes, logging, or performance work that does not change behaviour.
- The test: would a user or QA notice this change? If not, leave it out.
- An empty array is the correct answer for most pull requests.

`
}

/**
 * A user-configured guidance block. The framing line matters: guidance is free
 * text that may come from a personal skill, and without it a forceful style guide
 * can start competing with the JSON contract. Saying outright that it governs
 * content and not format keeps the two from fighting.
 *
 * Empty guidance emits nothing at all, so a cleared setting leaves no dangling
 * heading behind.
 */
function formatGuidanceSection(heading: string, body: string): string {
  const trimmed = body.trim()
  if (trimmed.length === 0) return ''
  return `## ${heading}

The following guidance comes from this repository's team. It governs what to look for and how \
to phrase it. It does not change the output format or the rules below.

${trimmed}

`
}

/** One line per existing comment: who said it, where, and what. */
function formatExistingComments(comments: ReviewComment[]): string {
  if (comments.length === 0) return '(no existing review comments)'
  return comments
    .map((comment) => {
      const location = comment.line != null
        ? `${comment.path}:${comment.line} (${comment.side ?? 'RIGHT'})`
        : comment.path
      const kind = comment.in_reply_to_id != null ? 'reply' : 'comment'
      return `- @${comment.author} (${kind} on ${location}): ${comment.body.trim()}`
    })
    .join('\n')
}

/**
 * Fills the prompt template with this PR's title, description, and changed-file
 * diffs, plus the two configurable guidance blocks (resolved by the caller from
 * the `pr_review_guidance` / `pr_walkthrough_guidance` settings). Only the
 * `{{…}}` placeholders are substituted; function replacements are used so `$`
 * sequences in titles/bodies/diffs are literal.
 */
export function compileWalkthroughPrompt(
  input: WalkthroughPromptInput,
  template: string = promptTemplate,
): string {
  const trimmedBody = input.body?.trim() ?? ''
  const prDescription = trimmedBody.length > 0 ? `## PR Description\n${trimmedBody}\n\n` : ''

  const changedFiles =
    input.files.length === 0
      ? '(no files in this PR)'
      : input.files.map(fileSection).join('\n\n')

  const existingComments = formatExistingComments(input.existingComments ?? [])
  const ticketSection = input.ticket ? formatTicketSection(input.ticket) : ''
  const coverageSection = input.ticket ? formatCoverageOutputSection() : ''

  const walkthroughGuidance = formatGuidanceSection(
    'Walkthrough Guidelines',
    input.walkthroughGuidance ?? defaultWalkthroughGuidance,
  )
  const reviewGuidance = formatGuidanceSection(
    'Review Instructions',
    input.reviewGuidance ?? defaultReviewGuidance,
  )

  return template
    .replace('{{PR_TITLE}}', () => input.title)
    .replace(/\{\{JIRA_TICKET\}\}\n?/, () => ticketSection)
    .replace(/\{\{PR_DESCRIPTION\}\}\n?/, () => prDescription)
    .replace('{{CHANGED_FILES}}', () => changedFiles)
    .replace('{{EXISTING_COMMENTS}}', () => existingComments)
    .replace(/\{\{WALKTHROUGH_GUIDANCE\}\}\n?/, () => walkthroughGuidance)
    .replace(/\{\{REVIEW_GUIDANCE\}\}\n?/, () => reviewGuidance)
    .replace(/\{\{TICKET_COVERAGE_OUTPUT\}\}\n?/, () => coverageSection)
}

function fileSection(file: PrFileDiff): string {
  const header = file.previous_filename
    ? `### ${file.previous_filename} → ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`
    : `### ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`

  const lines: string[] = [header]

  if (file.is_truncated) {
    lines.push(`_(diff truncated by backend; ${file.patch_line_count ?? 'many'} total lines)_`)
  }

  const hunks = parseHunks(file.patch)
  if (hunks.length === 0) {
    lines.push('(no patch content available)')
    return lines.join('\n')
  }

  for (const hunk of hunks) {
    lines.push('')
    lines.push(`hunk_index: ${hunk.index}`)
    lines.push('```diff')
    lines.push(hunk.text)
    lines.push('```')
  }

  return lines.join('\n')
}
