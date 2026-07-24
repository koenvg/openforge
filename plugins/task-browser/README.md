# Task Browser plugin

A small Trusted Plugin that adds a **Browser** tab to every Task and exercises OpenForge's secure Task Browser Surface API.

## Try it locally

1. Build the plugin:

   ```sh
   pnpm --filter @openforge-app/plugin-task-browser build
   ```

2. Build and launch the production Electron renderer:

   ```sh
   pnpm electron:package
   open "src-tauri/target/release/bundle/electron/macos/Open Forge.app"
   ```

   Do not use `pnpm electron:dev` for this external Svelte plugin. The Vite dev renderer currently has a separate Svelte runtime and reports `effect_orphan`; production builds externalize the host renderer to the shared plugin Svelte runtime.

3. Open **Settings → Plugins** in the packaged app.
4. Choose **local path**, enter the absolute path to `plugins/task-browser`, and click **Install package**.
5. Enable **Task Browser** for the active project.
6. Open any Task and select its **Browser** tab.

The tab opens `https://example.com` the first time. Enter any HTTP(S) address in the toolbar. The last successful URL is saved in plugin Task storage and restored when the live surface must be recreated.

Site permissions, popups, and downloads intentionally fail closed in this first secure browser-surface path.
