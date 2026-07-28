# Task Browser plugin

A built-in Trusted Plugin that adds a **Browser** tab to every Task through OpenForge's secure Task Browser Surface API. It remains an SDK-based plugin package and uses the same runtime contract as externally installed plugins.

## Try it locally

1. Build the built-in plugin:

   ```sh
   pnpm --filter @openforge-app/plugin-task-browser build
   ```

2. Launch the full Electron development app:

   ```sh
   pnpm electron:dev
   ```

3. Open any Task and select its **Browser** tab. Task Browser is enabled by default as a built-in plugin and can be disabled through **Settings → Plugins**.

The tab opens `https://example.com` the first time. Enter any HTTP(S) address in the toolbar. The last successful URL is saved in plugin Task storage and restored when the live surface must be recreated.

Recognized site permissions are mediated by Electron-owned prompts and may be remembered for the Task Browser Session; unsupported permission requests fail closed. Policy-approved HTTP(S) popups open in secured, host-owned windows, while disallowed popups fail closed. Every download opens an Electron-main-owned native Save dialog; canceling it cancels the download, and the plugin never receives a native download handle or destination path.
