import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { commentableLines } from './hunkParser'

export interface ValidatedReviewComment {
  filename: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  kind: 'question' | 'suggestion' | 'note'
}

const KINDS = new Set(['question', 'suggestion', 'note'])

export function parseAndValidateReviewComments(
  raw: string | null | undefined,
  files: PrFileDiff[],
): ValidatedReviewComment[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const commentsRaw = (parsed as Record<string, unknown>).review_comments
  if (!Array.isArray(commentsRaw)) return []

  const linesByFile = new Map<string, { right: Set<number>; left: Set<number> }>()
  for (const f of files) linesByFile.set(f.filename, commentableLines(f.patch))

  const out: ValidatedReviewComment[] = []
  for (const c of commentsRaw) {
    if (!c || typeof c !== 'object') continue
    const obj = c as Record<string, unknown>
    const filename = obj.filename
    const line = obj.line
    const side = obj.side
    const body = obj.body
    if (typeof filename !== 'string' || typeof body !== 'string') continue
    if (typeof line !== 'number' || !Number.isInteger(line)) continue
    if (side !== 'LEFT' && side !== 'RIGHT') continue
    const lines = linesByFile.get(filename)
    if (!lines) continue
    const set = side === 'RIGHT' ? lines.right : lines.left
    if (!set.has(line)) continue
    const kindRaw = obj.kind
    const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw)
      ? (kindRaw as ValidatedReviewComment['kind'])
      : 'note'
    out.push({ filename, line, side, body: body.trim(), kind })
  }
  return out
}
