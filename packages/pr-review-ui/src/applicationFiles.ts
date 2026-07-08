// Classifies changed files as "application" (real product source) vs
// "non-application" (tests, fixtures, snapshots, docs, generated scaffolding, …).
//
// The diff/review UIs hide non-application files by default so a reviewer sees the
// meaningful source changes first, and can opt into the rest with a single toggle
// ("Also include non-application files").
//
// Each pattern is matched against a changed file's repo-relative path
// (PrFileDiff.filename). A file is non-application if it matches ANY pattern.
// These are ported verbatim from the reviewer's spec — add or remove entries here
// to tune the set; every consumer picks up the change.

const NON_APPLICATION_FILE_PATTERNS: readonly RegExp[] = [
  /^apps\/[^/]+\/e2e\//, // Playwright e2e — entire tree (specs, page objects, fixtures, test data)
  /\.cy\.(ts|tsx)$/, // Cypress component tests
  /\.(test|spec)\.(ts|tsx)$/, // Unit / spec tests
  /component-index\.html$/, // Cypress test-harness HTML
  /\.stories\.(ts|tsx)$/, // Storybook stories
  /\.figma\.(ts|tsx)$/, // Figma Code Connect
  /\/(__mocks__|__tests__|test-utils|test-helpers)\/|\.mocks?\.(ts|tsx)$|\/mocks?\.(ts|tsx)$/, // Mocks / test-support
  /\/__snapshots__\/|\/(fixtures|__fixtures__)\//, // Snapshots / fixtures directories
  /\.mdx?$|\.mdc$/, // Docs (markdown / mdc)
  /__tmpl__/, // Nx generator templates
  /\.gitkeep$/, // Repo placeholders
  /\.patch$/, // Patches
]

/** True when the given repo-relative path is a non-application file. */
export function isNonApplicationFile(filename: string): boolean {
  return NON_APPLICATION_FILE_PATTERNS.some((pattern) => pattern.test(filename))
}

/** Count of non-application files in a list of changed files. */
export function countNonApplicationFiles<T extends { filename: string }>(files: readonly T[]): number {
  let count = 0
  for (const file of files) {
    if (isNonApplicationFile(file.filename)) count += 1
  }
  return count
}

/**
 * Returns the files to display given the toggle state. When non-application files are
 * excluded (the default), only application files remain; otherwise the list is returned
 * unchanged. Never mutates the input.
 */
export function filterApplicationFiles<T extends { filename: string }>(
  files: readonly T[],
  includeNonApplication: boolean,
): T[] {
  if (includeNonApplication) return [...files]
  return files.filter((file) => !isNonApplicationFile(file.filename))
}
