type Registry = Record<string, unknown>
type RegistryEntry = [string, unknown]

export function assertRegistryMatchesCanonicalManifest(options: {
  registryName: string
  actual: unknown
  expected: Registry
  invalidRegistryMessage?: string
  includeActualEntry?: (entry: RegistryEntry) => boolean
  formatMissingOrMismatched?: (entry: RegistryEntry) => string
}): void
