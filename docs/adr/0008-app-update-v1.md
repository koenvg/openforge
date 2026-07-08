# Add user-initiated in-app App Updates using trusted stable DMG releases

Status: Accepted
Date: 2026-07-08
Task: KVG-1436

OpenForge will add **App Update** v1 as a user-initiated in-app flow for updating the installed desktop app from trusted stable GitHub Releases. Electron main owns the update orchestration because downloading, verifying, replacing, and relaunching the app bundle is shell-level work; Svelte should reach it through typed IPC only. The first implementation will reuse the existing DMG replacement model rather than Electron autoUpdater: quietly check for a newer stable published release, show a subtle **App Update Indicator** plus a primary Settings action, link to GitHub release notes, require explicit confirmation before quitting/replacing the app, warn when active **Agent Sessions** or **Terminal Surfaces** may be interrupted, refresh the bundled CLI payload as part of the app replacement, and relaunch when complete.

The updater must only offer releases that satisfy the project release security bar, so macOS signing/notarization/trust prerequisites are a dependency before enabling the in-app install button. Update installation must preserve the current installed app if download, verification, staging, or replacement fails. Automatic rollback after a successful v1 replacement is out of scope; users can manually reinstall a prior trusted release if needed.

Considered options: Electron autoUpdater/Squirrel-style feeds were rejected for v1 because the project already publishes DMG artifacts and the current installer flow can be reused with clearer control over the app, Rust Sidecar, built-in plugin artifacts, and CLI payload as one version-locked bundle. CLI-only updates were rejected because the target is the desktop app update button, not a standalone OpenForge CLI update.