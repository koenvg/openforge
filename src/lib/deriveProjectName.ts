/**
 * Derives a default project name from a repository path by taking the final
 * path segment (the repository folder name). Handles POSIX and Windows
 * separators plus trailing slashes. Returns an empty string when no segment
 * can be derived (e.g. the filesystem root or an empty path).
 */
export function deriveProjectNameFromPath(path: string): string {
  const segments = path.trim().split(/[\\/]+/).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}
