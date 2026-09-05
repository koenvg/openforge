# Selected theme fixture

This ready-to-install Trusted Plugin registers `selected-theme-fixture:paper`. It ships a complete palette and two theme stylesheets. `view.css` is ordinary plugin CSS and is deliberately not a theme stylesheet.

## Try it in OpenForge

1. Install this directory as a local plugin. Enable **Selected theme fixture** in Global Settings.
2. Confirm **Fixture Paper** appears in the theme preference, with plugin ownership. Merely enabling the plugin must not add a brown line at the top of the window.
3. Select **Fixture Paper**. The canvas becomes warm paper and a brown line appears at the top. Both `--selected-theme-fixture-paper` and `--selected-theme-fixture-accents` become `applied` on the document root.
4. Restart OpenForge. The same qualified theme ID, palette, and CSS should return.
5. Reload the plugin. The old stylesheet elements disappear and the new generation restores the selected theme.
6. Switch to a built-in theme. The line and both fixture custom properties disappear; the plugin's view stylesheet remains loaded.
7. Select **Fixture Paper** again and disable or uninstall the plugin. Selection falls back to built-in light, and all of the plugin's stylesheet elements disappear.

To check failure recovery, rename `accents.css` temporarily and reload the plugin. The error must identify `selected-theme-fixture`; built-in light remains usable. Restore the file before re-enabling or reloading.

## Automated coverage

From the repository root:

```sh
pnpm exec vitest run src/lib/plugin/pluginRegistry.themeStylesheets.test.ts src/lib/themeStylesheetLifecycle.test.ts
```

These tests exercise the real plugin loader, registration lifecycle, settings controller, document adapter, and theme registry. IPC and module acquisition are test boundaries. jsdom load/error events are controlled explicitly so tests can hold candidates inactive and force races. They do not verify browser CSS rendering.

The fixture uses only public SDK imports. Trusted theme CSS can alter the whole app and break layout or accessibility; normal theme authors should prefer semantic tokens.
