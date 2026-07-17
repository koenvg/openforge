// Turns a rough note into a well-formed issue draft via the Anthropic API.
//
// Ported from the github-roadmap reference implementation (src/lib/groq/client.ts),
// which is the source of truth for the prompt. Two things differ, both because the
// provider does:
//
//   - The key is read from plugin storage rather than the environment: a desktop
//     plugin has no server-side env to hide a key in. See settings/apiKey.ts.
//   - The reference deliberately avoids JSON mode and splits a delimited plain-text
//     reply, because Groq's json_object mode is prompt-guided rather than
//     grammar-constrained, so a rich Markdown body escapes the envelope. Claude's
//     structured outputs ARE grammar-constrained, so the envelope cannot be
//     corrupted by the body and the delimited format and its lenient parser are
//     unnecessary. The title-style rules the format guide also carried are kept
//     below as TITLE_GUIDE — they are prompt guidance, not envelope mechanics.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5'
// Matches the reference implementation's ceiling: enough for a structured body,
// short enough that a runaway generation can't stall the dialog.
const MAX_TOKENS = 1800
// A hard ceiling for a button someone is waiting on. The CLI path this replaces
// allowed 120s; anything near that is a failure worth surfacing, not waiting out.
const TIMEOUT_MS = 30_000
// One retry, not the SDK's default two: a rate limit that needs a second backoff
// has already blown the latency budget this whole change exists to protect.
const MAX_RETRIES = 1

/** A compact, model-facing snapshot of the repo, used to ground drafts. */
export interface RepoContext {
  /** owner/name */
  repo: string
  description: string | null
  /** Plain-text excerpt, possibly truncated. */
  readme: string
  labels: string[]
}

export interface TicketDraft {
  title: string
  body: string
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('Add an Anthropic API key in the global settings to enable AI ticket drafting.')
    this.name = 'MissingApiKeyError'
  }
}

/** Constrains the reply so a Markdown body can never corrupt the envelope. */
export const TICKET_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'The issue title, following the title rules in the system prompt.',
    },
    body: {
      type: 'string',
      description: 'The GitHub-flavored Markdown body, following the section rules in the system prompt.',
    },
  },
  required: ['title', 'body'],
} as const

// Optional repo grounding, shared by the draft and revise prompts.
function contextBlock(context?: RepoContext): string {
  if (!context) return ''
  const parts: string[] = [`- Repository: ${context.repo}`]
  if (context.description) parts.push(`- Description: ${context.description}`)
  if (context.labels.length) parts.push(`- Existing labels: ${context.labels.slice(0, 40).join(', ')}`)
  if (context.readme) parts.push(`- README excerpt:\n"""\n${context.readme}\n"""`)
  return `

Repository context — use it to ground the issue in this project's real terminology and how it actually works. Do not repeat it verbatim and do not contradict it:
${parts.join('\n')}`
}

// Title style. In the reference implementation these rules rode along inside the
// delimited format guide; the structured-output schema replaces the envelope but
// carries no style, so they live on their own here.
const TITLE_GUIDE = `The title is a concise, actionable title in the imperative mood, no more than ~80 characters, with no trailing period. Write it as a sentence, not a headline — capitalize only the first word and any proper nouns, e.g. "Add up/down buttons to navigate comments", never "Add Up/Down Buttons To Navigate Comments".`

// The shape and faithfulness rules for the issue body, reused by both prompts.
// Each section name is given as a literal "## " heading: naming the heading inline is
// what keeps the model from inventing one for the issue type (a "## Feature" wrapper)
// and from demoting the real sections into bullets.
//
// "## Problem" is a named section rather than an aside inside Summary because it used to
// be one ("a short ## Summary (the goal and why it matters)") and the model reliably
// dropped the why: it writes to the heading and skims the parenthetical. Summary now owns
// only the what, so the why has nowhere to hide.
const BODY_GUIDE = `Pick the sections that fit the note. Give every section its own "##" heading, exactly as named below, and never add a heading for the issue type itself:
- Feature / task / idea — "## Problem" first, then a short "## Summary" (what this changes), "## Details" or "## Proposed approach" as bullet points, and "## Acceptance criteria" as a "- [ ]" checklist.
- Bug — "## Summary", "## Steps to reproduce" (numbered), "## Expected behavior", and "## Actual behavior". A bug gets no "## Problem" section: expected vs actual behavior already states the problem.

"## Problem" comes first and is one or two sentences on what the reader runs into today and why that hurts. Describe the situation, never the absence of the feature: write "Finding where a long reply started means scrolling up through it slowly", never "Users cannot jump to the previous message" — restating the request as a lack tells the reader nothing they did not already know from the title. If the note does not give the problem, infer the most plausible one from the note and the repository context, and ask about it under "## Open questions".

Add a short "## Open questions" list when the note leaves genuine ambiguity. Stay faithful to the note: expand and structure it, but do not fabricate specific facts (numbers, file names, deadlines, external systems, APIs) that the note or repository context does not support — raise assumptions under Open questions instead. Write concrete, checkable statements; never pad with generic benefits or filler. Do not include labels, assignees, or other metadata.`

// Draft prompt. Kept pure and exported so the prompt (and how context is woven in)
// can be unit-tested.
export function buildDraftPrompt(context?: RepoContext): string {
  return `You turn a developer's rough note into a single, well-structured GitHub issue.${contextBlock(context)}

${TITLE_GUIDE}

${BODY_GUIDE}`
}

// Revise prompt: edit an EXISTING draft per the author's feedback instead of drafting
// from scratch — the model keeps what already works and changes only what's asked.
export function buildReviseDraftPrompt(context?: RepoContext): string {
  return `You revise an existing GitHub issue draft based on the author's feedback.${contextBlock(context)}

Apply the feedback to the current draft: keep what already works, change what the feedback asks for, and don't drop sections the feedback didn't mention.

${TITLE_GUIDE}

${BODY_GUIDE}`
}

export interface ReviseInput {
  draft: TicketDraft
  feedback: string
  /** The original rough note, kept as extra grounding. */
  note?: string
  context?: RepoContext
}

// The user turn for a revision: the current draft, the feedback to apply, and the
// original note for context. Pure/exported so the wiring can be unit-tested.
export function buildReviseMessage({ draft, feedback, note }: ReviseInput): string {
  const parts = [
    'Revise this issue draft.',
    '',
    `Current title: ${draft.title}`,
    '',
    'Current body:',
    `"""${draft.body}"""`,
    '',
    "Author's feedback to apply:",
    `"""${feedback}"""`,
  ]
  if (note && note.trim()) parts.push('', 'Original note (for context):', `"""${note.trim()}"""`)
  parts.push('', 'Return the revised title and body.')
  return parts.join('\n')
}

// Map a failure to something a user can act on. The reference implementation parses
// Groq's error envelope by hand; the Anthropic SDK already exposes a status, so the
// work here is turning that status into an action ("wait" vs "fix your key").
export function describeAnthropicError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return error.message

  const status = (error as { status?: number } | null)?.status
  if (status === 401 || status === 403) {
    return 'Anthropic rejected the API key — check the key in the global settings.'
  }
  if (status === 429) {
    return 'Anthropic rate limit reached — wait a few seconds and try Refine again.'
  }
  if (status === 529 || (typeof status === 'number' && status >= 500)) {
    return 'Anthropic is temporarily unavailable — try Refine again in a moment.'
  }

  const message = error instanceof Error ? error.message : String(error)
  return message || 'The AI request failed.'
}

function clientFor(key: string): Anthropic {
  return new Anthropic({ apiKey: key, maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS })
}

// Structured outputs guarantee the reply validates against TICKET_DRAFT_SCHEMA, so the
// only failures worth handling here are a truncated generation and an empty reply —
// neither of which the schema can prevent.
async function callAnthropic(key: string, system: string, user: string): Promise<TicketDraft> {
  const response = await clientFor(key).messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    output_config: { format: { type: 'json_schema', schema: TICKET_DRAFT_SCHEMA } },
    messages: [{ role: 'user', content: user }],
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error('The AI response was cut off before it finished. Try a shorter note.')
  }

  const text = response.content.find((block) => block.type === 'text')?.text ?? ''
  if (!text.trim()) throw new Error('The AI returned an empty response.')

  const draft = JSON.parse(text) as TicketDraft
  if (!draft.title?.trim()) throw new Error('The AI did not return a usable title.')
  if (!draft.body?.trim()) throw new Error('The AI did not return a usable body.')
  return { title: draft.title.trim(), body: draft.body.trim() }
}

export async function refineTicket(key: string, text: string, context?: RepoContext): Promise<TicketDraft> {
  if (!key) throw new MissingApiKeyError()
  return callAnthropic(key, buildDraftPrompt(context), `Turn this note into an issue:\n\n"""${text}"""`)
}

export async function reviseTicket(key: string, input: ReviseInput): Promise<TicketDraft> {
  if (!key) throw new MissingApiKeyError()
  return callAnthropic(key, buildReviseDraftPrompt(input.context), buildReviseMessage(input))
}
