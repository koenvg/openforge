import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'
import promptTemplate from './walkthroughPrompt.md?raw'

/**
 * Built-in walkthrough + AI-review prompt template. Also the runtime fallback when
 * the `pr_walkthrough_prompt` setting is unset. Kept byte-identical to the core
 * copy (`src/lib/prWalkthroughPrompt.md`) via prWalkthroughPrompt.test.ts.
 */
export const DEFAULT_WALKTHROUGH_PROMPT = promptTemplate

export interface WalkthroughPromptInput {
  title: string
  body: string | null
  files: PrFileDiff[]
}

/**
 * Fills the prompt template with this PR's title, description, and changed-file
 * diffs. The template defaults to the built-in one but can be overridden (the
 * configurable `pr_walkthrough_prompt` setting is resolved by the caller and
 * passed in). Only the `{{…}}` placeholders are substituted; function
 * replacements are used so `$` sequences in titles/bodies/diffs are literal.
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

  return template
    .replace('{{PR_TITLE}}', () => input.title)
    .replace(/\{\{PR_DESCRIPTION\}\}\n?/, () => prDescription)
    .replace('{{CHANGED_FILES}}', () => changedFiles)
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
