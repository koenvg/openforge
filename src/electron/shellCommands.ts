export type OpenExternal = (url: string) => Promise<void>

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

export async function openExternalUrl(url: string, openExternal: OpenExternal): Promise<null> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('open_url only supports http and https URLs')
  }

  await openExternal(url)
  return null
}

function isAbsoluteFsPath(value: string): boolean {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))
}

/**
 * Open an absolute filesystem path in VS Code via its `vscode://file` deep link.
 * Takes a path (not an arbitrary URL) so the renderer cannot smuggle other schemes
 * through; the `vscode:` URL is constructed here in the main process.
 */
export async function openPathInEditor(path: string, openExternal: OpenExternal): Promise<null> {
  if (!isAbsoluteFsPath(path)) {
    throw new Error('open_in_editor requires an absolute filesystem path')
  }

  const normalized = path.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  await openExternal(`vscode://file${withLeadingSlash}`)
  return null
}
