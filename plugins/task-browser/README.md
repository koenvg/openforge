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

The tab starts on a blank page the first time so opening a Task never depends on external network access. Enter any HTTP(S) address in the toolbar. The last successful URL is saved in plugin Task storage and restored when the live surface must be recreated.

Every Browser tab shares one Plugin Browser Session, so logging in to a site such as GitHub in one Task logs you in for every other Task and project too. The session outlives the Tasks that used it: completing or deleting a Task leaves it intact. It is destroyed only by an explicit session reset — which signs you out everywhere at once — or by uninstalling the plugin. See [ADR 0012](../../docs/adr/0012-plugin-scoped-browser-sessions.md).

When Task Browser is enabled, HTTP(S) links activated in a Task's Agent or Terminal surface navigate the Task's existing Browser surface and foreground this tab. Disabling the plugin preserves the previous behavior by opening those links in the external browser.

Recognized site permissions are mediated by Electron-owned prompts and may be remembered for the Plugin Browser Session; unsupported permission requests fail closed. Policy-approved HTTP(S) popups open in secured, host-owned windows, while disallowed popups fail closed. Every download opens an Electron-main-owned native Save dialog; canceling it cancels the download, and the plugin never receives a native download handle or destination path.
