/** Display-only preview of the clone destination: `<parent>/<repoName>`. */
export function computeTargetPathPreview(parentDir: string, repoName: string): string {
  const parent = parentDir.trim().replace(/[/\\]+$/, '')
  const repo = repoName.trim()
  if (!parent || !repo) return ''
  return `${parent}/${repo}`
}

/** Submit gating for the "New GitHub repo" mode. */
export function canSubmitNewRepo(args: {
  name: string
  parentDir: string
  isSubmitting: boolean
}): boolean {
  return (
    !args.isSubmitting &&
    args.name.trim().length > 0 &&
    args.parentDir.trim().length > 0
  )
}

/** Submit gating for the "From GitHub" mode. */
export function canSubmitGithub(args: {
  repoUrl: string
  parentDir: string
  projectName: string
  isSubmitting: boolean
}): boolean {
  return (
    !args.isSubmitting &&
    args.repoUrl.trim().length > 0 &&
    args.parentDir.trim().length > 0 &&
    args.projectName.trim().length > 0
  )
}
