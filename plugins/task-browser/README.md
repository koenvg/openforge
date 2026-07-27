# Task Browser plugin

A small Trusted Plugin that adds a **Browser** tab to every Task and exercises OpenForge's secure Task Browser Surface API.

## Try it locally

1. Build the plugin:

   ```sh
   pnpm --filter @openforge-app/plugin-task-browser build
   ```

2. Launch the full Electron development app:

   ```sh
   pnpm electron:dev
   ```

   The Vite renderer and external plugins share one Svelte runtime, so runes such as `$effect` work in locally installed plugin components.

3. Open **Settings → Plugins**.
4. Choose **local path**, enter the absolute path to `plugins/task-browser`, and click **Install package**.
5. Enable **Task Browser** for the active project.
6. Open any Task and select its **Browser** tab.

The tab opens `https://example.com` the first time. Enter any HTTP(S) address in the toolbar. The last successful URL is saved in plugin Task storage and restored when the live surface must be recreated.

Site permissions and popups currently fail closed. Every download opens an Electron-main-owned native Save dialog; canceling it cancels the download, and the plugin never receives a native download handle or destination path.
