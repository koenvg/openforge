import type { PrFileDiff } from '@openforge/plugin-sdk/domain'

/**
 * Identity for the inputs that determine a Diff File Section's rendered content.
 * The same filename can represent different comparisons, such as all changes
 * versus a Reviewed File Snapshot -> current comparison.
 */
export function getDiffFileSectionInputKey(file: PrFileDiff): string {
  return [
    file.filename,
    file.previous_filename ?? '',
    file.status,
    file.sha,
    file.patch ?? '',
    file.is_truncated === true ? 'truncated' : 'full',
    String(file.patch_line_count ?? ''),
  ].join('\0')
}
