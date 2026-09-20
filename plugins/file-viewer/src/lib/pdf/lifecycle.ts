const owners = new Set<() => void>()

export function registerPdfOwner(dispose: () => void): () => void {
  owners.add(dispose)
  return () => owners.delete(dispose)
}

export function deactivatePdfPreviews(): void {
  for (const dispose of owners) dispose()
  owners.clear()
}
