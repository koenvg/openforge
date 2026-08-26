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

The Developer Tools button opens full Chromium DevTools for the current Task Browser Surface in development and packaged builds. `F12`, `Ctrl+Shift+I` on Windows/Linux, and `Cmd+Option+I` on macOS toggle the tools. The matching `C` and `J` shortcuts open Elements selection and Console while the Browser tab or a browser popup has focus. Right-click a page and choose **Inspect element** to inspect that location. Chromium remembers the chosen dock position, while the open state lasts only for the live surface.

Every Browser tab shares one Plugin Browser Session, so logging in to a site such as GitHub in one Task logs you in for every other Task and project too. The session outlives the Tasks that used it: completing or deleting a Task leaves it intact. It is destroyed only by an explicit session reset, which signs you out everywhere at once, or by uninstalling the plugin.

Task Browser visual feedback stays on the live page: add numbered region comments, then use the compact review controls to correct comments or normalized marker geometry, remove findings/captures, or undo the latest change. Unsent drafts persist per Task; save failures remain retryable in memory, and missing background PNGs are reported on each affected finding. **Send to agent** submits the corrected deterministic Markdown report immediately while retained background PNGs remain immutable Task artifacts for the Agent.

When Task Browser is enabled, HTTP(S) links activated in a Task's Agent or Terminal surface navigate the Task's existing Browser surface and foreground this tab. Disabling the plugin preserves the previous behavior by opening those links in the external browser.

Recognized site permissions are mediated by Electron-owned prompts and may be remembered for the Plugin Browser Session; unsupported permission requests fail closed. Policy-approved HTTP(S) popups open in secured, host-owned windows, while disallowed popups fail closed. Every download opens an Electron-main-owned native Save dialog; canceling it cancels the download, and the plugin never receives a native download handle or destination path.
