# Plugin publishing and installation

OpenForge plugins are **Trusted Plugins** packaged like normal npm packages. This guide is the build, package, install, and versioning checklist for authors and reviewers who need to confirm a package is ready for **Plugin Installation** and safe to enable for a **Project**.

For the full authoring contract, see [OpenForge plugin authoring](../plugin-authoring.md). For a first working plugin, see [Create an OpenForge plugin](./create-a-plugin.md).

## Publishing contract at a glance

A publishable package must:

- include a valid `package.json` with `name`, `version`, and `package.json#openforge` metadata;
- set `openforge.apiVersion` to the supported plugin API version, currently `1`;
- declare at least one built JavaScript entry point with `openforge.frontend` or `openforge.backend`;
- include the built files those entry points reference, usually under `dist/`;
- register contributions at runtime from `activate()` rather than declaring legacy `openforge.contributes` metadata;
- list only documented host capabilities in `openforge.requires`;
- stay inside the documented SDK boundary instead of importing Electron, preload APIs, app stores, SQLite, the **Rust Sidecar**, or other OpenForge internals directly.

## Package contents

A small package usually looks like this before publishing or local installation:

```text
acme-notes-plugin/
  package.json
  dist/
    frontend.js
    backend.cjs
```

Source files, tests, and build configuration may exist in the author repository, but they are not required in the installed package unless you intentionally publish them for review or debugging. A minimal `files` list for an npm package often includes only `dist` and `package.json`.

Reviewer checklist:

- `package.json` is the package/discovery manifest; there is no separate `manifest.json` contract.
- `package.json#openforge.id` is stable and unique app-wide.
- `package.json#openforge.displayName` and `description` describe what the **Trusted Plugin** does for users.
- `package.json#openforge.frontend`, when present, points to a relative `.js`, `.mjs`, or `.cjs` file inside the package.
- `package.json#openforge.backend`, when present, points to a relative CommonJS `.cjs` file inside the package; TypeScript and ESM backend entries are not supported.
- Entry paths do not use absolute paths or `..` traversal.
- Assets and extra files are intentionally included and do not expose secrets or unrelated project data.

## Build before packaging

OpenForge does not compile plugin source during **Plugin Installation**. Installed packages must already contain the `dist/` artifacts named by `package.json#openforge`.

Author checklist before publishing, installing from npm, installing from git, or installing from a local path:

1. Run the plugin package build.
2. Confirm every entry file referenced by `openforge.frontend` or `openforge.backend` exists in the packaged output.
3. Confirm frontend bundles use the documented host-shared Svelte setup and do not bundle their own Svelte runtime.
4. Run the plugin's focused tests, especially registration, lifecycle cleanup, backend RPC, storage scoping, and **Task** automation.
5. Inspect the packed contents, for example with the package manager's pack/list tooling, before distributing the package.

If an entry file is missing, OpenForge rejects the package with a build-required error instead of compiling it. If `openforge.contributes` is present, OpenForge rejects the package because contributions must be registered at runtime.

## Metadata and API version compatibility

`openforge.apiVersion` is the hard compatibility gate between the package and OpenForge. The current plugin API version is `1`.

Compatibility rules:

- Each built frontend or backend artifact targets one `openforge.apiVersion`.
- Peer dependencies on `@openforge-app/plugin-sdk` are useful authoring diagnostics, but they are not the runtime compatibility source of truth.
- `openforge.requires` must contain only documented capability names. Unknown capability names are rejected during metadata validation.
- Runtime capability availability is still determined by the active OpenForge host. Unsupported calls fail with named capability errors rather than silently doing nothing.
- If a plugin needs an API that is not documented in the SDK types, treat it as unavailable until OpenForge documents it.

Versioning checklist for releases:

- Bump the package `version` when package contents or behavior change.
- Keep `openforge.id` stable for updates to the same **Trusted Plugin**.
- Change `openforge.id` only when the package should install as a separate plugin with separate enablement and storage.
- Review capability additions carefully: adding `tasks`, `fs`, `shell`, `notifications`, `attention`, or `system.openUrl` changes what the **Trusted Plugin** may do through host capabilities.

## Installation sources and installed locations

OpenForge's package installer accepts the source forms documented for the plugin manager model:

```text
npm:@acme/openforge-notes@0.1.0
git:github.com/acme/openforge-notes@main
/path/to/local/openforge-notes
local:/path/to/local/openforge-notes
```

Current installation behavior:

- npm sources are acquired with `npm install` in a staging area using production dependencies and script execution disabled, then copied into OpenForge's managed plugin directory.
- git sources are shallow-cloned into a staging area, then copied into OpenForge's managed plugin directory.
- local sources are referenced from their canonical local directory; OpenForge does not copy them into the managed plugin directory.
- The installed plugin record stores the source kind, source spec, install path, package metadata, version, and install timestamp.
- npm and git staging directories are cleaned up after installation succeeds or fails.

Do not document or rely on an OpenForge plugin CLI command unless one is explicitly added to the public product. The supported contract for authors is the package shape and source specs; OpenForge owns how the **Rust Sidecar** acquires and records packages.

## Plugin Installation versus Project Plugin Enablement

OpenForge separates availability from project use:

- **Plugin Installation** records a **Trusted Plugin** as available app-wide, without making it active for any **Project**.
- **Project Plugin Enablement** makes an installed **Trusted Plugin** active or inactive for one **Project**.

This separation is part of the review model. Installing code answers, "Is this package trusted and available in this OpenForge app?" Enabling answers, "Should this **Project** let this **Trusted Plugin** contribute UI, background behavior, or automation?"

Enablement expectations:

- Installing a non-built-in **Trusted Plugin** does not automatically enable it for every **Project**.
- Newly installed non-built-in **Trusted Plugins** start disabled for every **Project** until explicitly enabled.
- A completed **Plugin Installation** may offer a convenience action to enable the plugin for the active **Project**, but that action is still explicit **Project Plugin Enablement**.
- Built-in **Trusted Plugins** may be enabled by default for projects.
- Built-in **Trusted Plugins** can still be explicitly disabled through **Project Plugin Enablement** for a **Project**.
- Global plugin settings should manage **Plugin Installation** inventory; project plugin settings should manage **Project Plugin Enablement** for the active **Project**.

Reviewer checklist before enabling for a **Project**:

- The requested capabilities match the **Project** workflow need.
- Any **Task** automation respects OpenForge's model: plugin-created **Tasks** enter the backlog, and starting an **Implementation Run** uses **Project Agent Settings** rather than plugin-supplied provider, model, permission mode, branch, or workspace overrides.
- Background services are scoped and quiet enough for the **Project**.
- User-facing labels and concepts that are not core OpenForge language are clearly owned by the plugin.

## Reviewable install, update, and remove behavior

### Install review

Before approving **Plugin Installation**, review:

- source spec and resolved package identity;
- package `name`, `version`, and `openforge.id`;
- built entry files and package contents;
- `openforge.requires` capabilities;
- frontend and backend entry separation;
- whether the package is built-in, npm, git, or local;
- diagnostics from any install validation failure.

A successful **Plugin Installation** is only app-wide availability. It should not be treated as approval for all projects.

### Update review

There is no separate author-facing update manifest. Reinstalling a package with the same `openforge.id` updates the installed plugin metadata and package location recorded for that id.

Update expectations:

- Project enablement for that plugin id is preserved when the package is reinstalled.
- Already enabled projects may see the new plugin behavior after the host reloads or reactivates the plugin.
- Review package diffs, capability changes, entry path changes, and version changes before reinstalling over an existing id.
- For npm and git sources, the managed plugin directory for that id is replaced with the newly acquired package contents.
- For local sources, OpenForge continues to reference the local package directory; authors should rebuild locally before reinstalling or reloading.

Reviewer checklist for an update:

- `openforge.id` is unchanged for an in-place update.
- Package `version` changed when behavior changed.
- New capabilities are expected and acceptable for each enabled **Project**.
- Removed capabilities or entries do not strand existing UI, background services, storage, or **Task** workflows.
- The update does not depend on unsupported OpenForge internals or undocumented APIs.

### Remove review

Removal differs for built-in and non-built-in plugins:

- Built-in **Trusted Plugins** cannot be uninstalled through the normal plugin uninstall path; use **Project Plugin Enablement** to disable them for a **Project**.
- Non-built-in plugins can be uninstalled.
- Uninstalling a non-built-in plugin removes its installed plugin record and associated project enablement records.
- For managed npm and git installs, OpenForge removes the managed plugin directory when it is under OpenForge's managed plugin root.
- For local installs, OpenForge does not delete the source directory.

Reviewer checklist before removal:

- Confirm no active **Project** still depends on the plugin's views, settings sections, background services, or **Task** automation.
- Export or migrate plugin-owned data first if the plugin provides its own export path.
- Prefer project disablement before uninstall when you only want to stop the plugin for one **Project**.
- Do not expect uninstalling a local plugin to clean up files in the author's local source tree.

## Author release checklist

Use this before handing a package to another reviewer or user:

- [ ] `package.json#openforge` validates against the current metadata schema.
- [ ] `openforge.apiVersion` is `1`.
- [ ] At least one built frontend or backend JavaScript entry exists.
- [ ] `dist/` contains the exact files referenced by metadata.
- [ ] No legacy `openforge.contributes` metadata remains.
- [ ] `openforge.requires` lists only needed documented capabilities.
- [ ] Frontend code uses documented SDK exports and Svelte 5-compatible host-shared runtime behavior.
- [ ] Backend code uses documented SDK exports and cleans up with `context.subscriptions`.
- [ ] Tests cover runtime registrations, cleanup, storage/config scoping, backend readiness/RPC, and **Task** behavior.
- [ ] The package contents are reviewable and exclude secrets, local credentials, and unrelated files.
- [ ] Release notes call out version, capability, storage, background-service, and **Project Plugin Enablement** impacts.

## Reviewer quick checklist

Use this when deciding whether a package is ready for **Plugin Installation** and possible **Project Plugin Enablement**:

- [ ] I trust the source and understand that this is a **Trusted Plugin**, not sandboxed code.
- [ ] The package includes already-built `dist/` artifacts.
- [ ] The package metadata and API version are compatible with this OpenForge build.
- [ ] The requested capabilities are necessary and understandable.
- [ ] The install source and installed package contents are reviewable.
- [ ] I know whether this is a built-in plugin, managed npm/git install, or local path install.
- [ ] I have separately decided which **Project**, if any, should enable it.
- [ ] For updates, I reviewed the diff and understand that existing **Project Plugin Enablement** is preserved.
- [ ] For removal, I understand whether OpenForge will remove a managed package directory or leave a local source directory untouched.
