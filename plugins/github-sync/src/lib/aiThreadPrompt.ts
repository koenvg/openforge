import type { AgentReviewComment, AiThread, PrFileDiff, PrWalkthroughStep } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'

export const AI_ANSWERS_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['thread_id', 'body'],
        properties: { thread_id: { type: 'string' }, body: { type: 'string' } },
      },
    },
  },
})

function anchorContext(
  thread: AiThread,
  files: PrFileDiff[],
  steps: PrWalkthroughStep[],
  agentComments: AgentReviewComment[],
): string {
  if (thread.anchor.type === 'step') {
    // Hoist the narrowed value: TS drops the discriminated-union narrowing of
    // `thread.anchor` inside the `.find` closure below.
    const stepId = thread.anchor.step_id
    const step = steps.find(s => s.id === stepId)
    return step
      ? `About walkthrough step "${step.title}": ${step.summary}`
      : `About walkthrough step ${stepId}`
  }
  const a = thread.anchor
  const file = files.find(f => f.filename === a.filename)
  const hunk = file ? parseHunks(file.patch).find(h => h.text.length > 0) : undefined
  const lineContext = `About ${a.filename} line ${a.line} (${a.side}):\n\`\`\`diff\n${hunk?.text ?? '(diff unavailable)'}\n\`\`\``
  if (a.type === 'comment') {
    // Hoist before the closure so the narrowing survives (see the step case).
    const commentId = a.comment_id
    const comment = agentComments.find(c => c.id === commentId)
    const suggestion = comment ? comment.body : '(original suggestion unavailable)'
    return `The reviewer is following up on your earlier AI review comment here:\n"${suggestion}"\n${lineContext}`
  }
  return lineContext
}

export function buildQuestionsPrompt(
  threads: AiThread[],
  files: PrFileDiff[],
  steps: PrWalkthroughStep[],
  agentComments: AgentReviewComment[] = [],
): string {
  const blocks = threads.map(t => {
    const convo = t.messages.map(m => `${m.role === 'user' ? 'Reviewer' : 'You'}: ${m.body}`).join('\n')
    return `--- thread_id: ${t.id} ---\n${anchorContext(t, files, steps, agentComments)}\n${convo}`
  })
  return [
    'You are the author of this pull request, answering a reviewer\'s questions. You are running inside a checkout of the PR head — read any file and use git history to answer precisely and honestly. If a choice was arbitrary, say so.',
    '',
    'Answer EACH thread below. Respond with a single JSON object: { "answers": [ { "thread_id": "<id>", "body": "<markdown answer>" } ] }. Include one entry per thread_id. No prose outside the JSON.',
    '',
    ...blocks,
  ].join('\n')
}

export function mapAnswersToThreads(
  raw: string,
  threads: AiThread[],
  now: () => number = () => Math.floor(Date.now() / 1000),
): AiThread[] {
  let byId = new Map<string, string>()
  try {
    const parsed = JSON.parse(raw) as { answers?: Array<{ thread_id?: unknown; body?: unknown }> }
    for (const a of parsed.answers ?? []) {
      if (typeof a?.thread_id === 'string' && typeof a?.body === 'string') byId.set(a.thread_id, a.body.trim())
    }
  } catch {
    byId = new Map()
  }
  const ts = now()
  return threads.map(t => {
    const answer = byId.get(t.id)
    if (answer === undefined) return { ...t, status: 'error', updated_at: ts }
    return { ...t, status: 'answered', updated_at: ts, messages: [...t.messages, { role: 'ai', body: answer, created_at: ts }] }
  })
}
