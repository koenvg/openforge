# @openforge-app/plugin-sdk

Public SDK for building OpenForge plugins. See [`docs/plugin-authoring.md`](../../docs/plugin-authoring.md) for the complete package, runtime, Svelte-sharing, and CSS-loading contract.

Styled frontend plugins must declare Vite/Svelte's emitted CSS artifacts in `package.json#openforge.frontendStyles`:

```json
{
  "openforge": {
    "frontend": "./dist/frontend.js",
    "frontendStyles": ["./dist/plugin.css"]
  }
}
```

The host validates, attaches, reloads, and removes these package-relative stylesheets with the frontend plugin lifecycle.

## License

`@openforge-app/plugin-sdk` is licensed under the MIT License. Plugin authors may use it for personal, internal, open source, or commercial plugin development, including redistribution and modification under the MIT terms.

This MIT license applies to the SDK package only. The OpenForge desktop application is licensed separately under the repository root `LICENSE` and is source-available/proprietary; the app may not be commercially resold or redistributed without permission.

## Current contract

Version `0.2.1` publishes the API-v1 contract used by the OpenForge host, including agent-facing Plugin Command metadata, `PluginCommandInvocationContext`, and the `@openforge-app/plugin-sdk/testing` helpers. Legacy handoff-summary declarations (`Task.summary` and `tasks.updateSummary`) are no longer part of the contract.

Desktop releases publish the SDK in the same workflow using the desktop git tag's semver; the manual publish workflow uses the checked-in package version. Both paths run `pnpm check:contract`, which packs the package, verifies all exported files, and compiles the current authoring contract against the tarball before publication.
