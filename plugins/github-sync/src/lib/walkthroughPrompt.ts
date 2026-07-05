import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'
import promptTemplate from './walkthroughPrompt.md?raw'

export interface WalkthroughPromptInput {
  title: string
  body: string | null
  files: PrFileDiff[]
}

/**
 * Fills the standalone prompt template (`walkthroughPrompt.md`) with this PR's
 * title, description, and changed-file diffs. The template holds the static
 * instructions so it can be viewed and shared on its own; only the `{{…}}`
 * placeholders are substituted here. Function replacements are used so `$`
 * sequences in titles/bodies/diffs are inserted literally.
 */
export function compileWalkthroughPrompt(input: WalkthroughPromptInput): string {
  const trimmedBody = input.body?.trim() ?? ''
  const prDescription = trimmedBody.length > 0 ? `## PR Description\n${trimmedBody}\n\n` : ''

  const changedFiles =
    input.files.length === 0
      ? '(no files in this PR)'
      : input.files.map(fileSection).join('\n\n')

  return promptTemplate
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
