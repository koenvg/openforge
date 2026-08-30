import { isDeepStrictEqual } from 'node:util'

export function assertRegistryMatchesCanonicalManifest({
  registryName,
  actual,
  expected,
  invalidRegistryMessage = `${registryName} must be an object`,
  includeActualEntry = () => true,
  formatMissingOrMismatched = ([key]) => key,
}) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(invalidRegistryMessage)
  }

  const comparableActual = Object.fromEntries(Object.entries(actual).filter(includeActualEntry))

  const missingOrMismatched = Object.entries(expected)
    .filter(([key, value]) => !isDeepStrictEqual(comparableActual[key], value))
    .map(formatMissingOrMismatched)
  const unexpected = Object.keys(comparableActual).filter((key) => !(key in expected))

  if (missingOrMismatched.length === 0 && unexpected.length === 0) return

  const details = [
    missingOrMismatched.length > 0 ? `missing or mismatched: ${missingOrMismatched.join(', ')}` : null,
    unexpected.length > 0 ? `not in the canonical manifest: ${unexpected.join(', ')}` : null,
  ].filter(Boolean)

  throw new Error(`${registryName} drifted from the canonical manifest (${details.join('; ')})`)
}
