// OpenSpec add-angular-extensible-theming, migration clusters 7.2 through 7.10.
// The hello-world demo was removed in 8d10247b; do not recreate it for inventory.
export const UI_MIGRATION_ROOTS = Object.freeze([
  'src',
  'packages/pr-review-ui/src',
  'packages/terminal-runtime/src',
  'packages/plugin-sdk/src',
  'plugins/file-viewer/src',
  'plugins/github-sync/src',
  'plugins/task-browser/src',
  'plugins/task-schedules/src',
  'plugins/terminal/src',
])

export function isInventorySource(path) {
  return /\.(?:svelte|[cm]?[jt]s|css)$/.test(path)
    && !/(?:^|\/)(?:__tests__|__fixtures__|testing|fixtures|visual)(?:\/|$)/.test(path)
    && !/(?:\.test\.|\.spec\.|TestWrapper\.|TestHarness\.|Harness\.)/.test(path)
}

export function checksPresentation(path) {
  return path.startsWith('src/components/')
    || path.startsWith('plugins/')
    || path.startsWith('packages/pr-review-ui/src/')
    || path.startsWith('packages/terminal-runtime/src/')
    || path === 'packages/plugin-sdk/src/ui/PluginSidebarLink.svelte'
}
