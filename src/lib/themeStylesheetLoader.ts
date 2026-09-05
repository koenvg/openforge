import type { RegisteredTheme, ThemePreparation } from './themeRegistry'

/** Theme CSS is independent of the plugin's always-active frontendStyles. */
export async function prepareThemeStylesheets(
  document: Document,
  theme: RegisteredTheme,
  signal: AbortSignal,
): Promise<ThemePreparation> {
  const links: HTMLLinkElement[] = []
  const dispose = () => {
    for (const link of links) {
      link.onload = null
      link.onerror = null
      link.remove()
    }
  }
  let rejectAborted: (error: unknown) => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
  const abort = () => {
    dispose()
    rejectAborted(signal.reason)
  }
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => {
    const owner = theme.owner.kind === 'plugin' ? `Plugin ${theme.owner.pluginId}` : 'Built-in'
    rejectAborted(new Error(`${owner} theme ${theme.id} stylesheet loading timed out: ${(theme.stylesheets ?? []).join(', ')}`))
  }, 15_000)
  try {
    signal.throwIfAborted()
    await Promise.race([
      aborted,
      Promise.all((theme.stylesheets ?? []).map(path => new Promise<void>((resolve, reject) => {
        if (theme.owner.kind !== 'plugin') {
          reject(new Error('Only plugin themes may load package stylesheets'))
          return
        }
        const pluginId = theme.owner.pluginId
        const link = document.createElement('link')
        links.push(link)
        link.rel = 'stylesheet'
        link.media = 'not all'
        link.dataset.openforgeThemeStylesheet = theme.id
        const assetPath = path.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/')
        link.href = `plugin://${pluginId}/${assetPath}?openforgeReload=${theme.owner.generation}`
        link.onload = () => resolve()
        link.onerror = () => reject(new Error(`Plugin ${pluginId} theme ${theme.id} failed to load stylesheet ${path}`))
        document.head.append(link)
      }))),
    ])
    for (const link of links) {
      link.onload = null
      link.onerror = null
    }
    return {
      activate: () => { for (const link of links) link.media = 'all' },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
