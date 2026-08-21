# @openforge-app/plugin-sdk

Public SDK for building OpenForge plugins. [`docs/plugin-authoring.md`](../../docs/plugin-authoring.md) is the canonical guide for the package, runtime, Svelte-sharing, and CSS-loading contract.

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

## Publishing

Automated releases use npm trusted publishing rather than a long-lived npm token. Configure the package's npm Trusted Publisher with repository `koenvg/openforge`, workflow `publish-plugin-sdk.yml`, and environment `npm-publish`. The workflow is the caller npm validates even though the shared publish steps live in `reusable-publish-plugin-sdk.yml`. For a failed tag release, dispatch this workflow manually with the missing `package_version` and disable dry-run.

## License

`@openforge-app/plugin-sdk` is licensed under the MIT License. Plugin authors may use it for personal, internal, open source, or commercial plugin development, including redistribution and modification under the MIT terms.

This MIT license applies to the SDK package only. The OpenForge desktop application is licensed separately under the repository root `LICENSE` and is source-available/proprietary; the app may not be commercially resold or redistributed without permission.
