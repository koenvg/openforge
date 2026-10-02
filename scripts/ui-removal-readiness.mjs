// Dispositions explain scanner false positives; they cannot permit legacy paint or build inputs.
export function findUiRemovalViolations(records, sourcePaths, policy) {
  const paths = new Set(sourcePaths)
  const negativeTests = policy.negativeTests ?? {}
  const violations = []
  const excluded = new Set()
  for (const [path, reason] of Object.entries(negativeTests)) {
    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || !paths.has(path) || typeof reason !== 'string' || !reason.trim()) {
      violations.push({ path, line: 1, kind: 'policy', token: 'Invalid negative-test exclusion' })
    } else excluded.add(path)
  }
  const remaining = records.filter(record => !excluded.has(record.path))
  const reviewable = new Set(['component', 'unresolved', 'script-component-candidate', 'script-variable-candidate', 'script-arbitrary-variable-candidate'])
  const keys = new Set()
  for (const entry of policy.reviewed ?? []) {
    const key = JSON.stringify([entry.path, entry.kind, entry.token])
    const valid = paths.has(entry.path) && !excluded.has(entry.path) && reviewable.has(entry.kind)
      && typeof entry.token === 'string' && entry.token.length > 0
      && typeof entry.reason === 'string' && entry.reason.trim()
      && Number.isInteger(entry.count) && entry.count > 0 && !keys.has(key)
    keys.add(key)
    if (!valid) {
      violations.push({ path: entry.path, line: 1, kind: 'policy', token: 'Invalid reviewed record' })
      continue
    }
    const matches = remaining.filter(record => record.path === entry.path && record.kind === entry.kind && record.token === entry.token)
    if (matches.length !== entry.count) {
      violations.push({ path: entry.path, line: 1, kind: 'policy', token: `Stale reviewed record: ${entry.token}, expected ${entry.count}, found ${matches.length}` })
      continue
    }
    for (const match of matches) remaining.splice(remaining.indexOf(match), 1)
  }
  return [...violations, ...remaining]
}
