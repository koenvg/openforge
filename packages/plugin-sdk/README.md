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

## Release metadata note

The next npm publish of `@openforge-app/plugin-sdk` should expose `license: "MIT"` in the package metadata. If the current npm registry entry shows missing or proprietary license metadata, publish a patch release with this package metadata to correct what npm consumers see.
