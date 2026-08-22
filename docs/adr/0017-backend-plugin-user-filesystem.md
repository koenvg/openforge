# ADR 0017: Scope backend plugin user filesystem access

Status: Accepted
Date: 2026-08-22
Task: KVG-3601
Source: Plugins task KVG-3553

## Context

Trusted backend plugins run in the shared Node plugin host. They can technically import `node:fs`, but the SDK only documented Project-scoped file operations. This left plugin authors without a stable, testable way to keep plugin-owned files or read user-selected data outside an OpenForge Project. KVG-3553 exposed the gap while building a Pi Skill Usage plugin that reads Pi sessions across Projects and stores local telemetry.

Treating direct `node:fs` access as the answer would bypass plugin namespacing, host path checks, and SDK testing fakes. Treating it as forbidden would misrepresent the trusted Node runtime.

## Decision

The existing `fs` capability remains the metadata identifier. Backend plugins receive two additional API groups:

- `openforge.fs.userData` reads and writes relative paths under an OpenForge app-data directory namespaced by the calling plugin id.
- `openforge.fs.external` reads relative paths under an absolute root supplied on every call. It has no write operation.

The Node plugin host adds the calling plugin id to user filesystem callbacks. Plugin code cannot choose another namespace through the SDK. The Rust host creates the user-data root on demand, canonicalizes read targets, and rejects absolute child paths, relative external roots, traversal outside the selected root, and writes through symlink targets. File methods are UTF-8 text-only and return the complete file so plugins can process session logs larger than the Project preview limit.

The user-data directory persists across disablement and uninstall. This avoids accidental data loss during plugin updates or reinstalls. A future explicit data-removal flow may delete it.

External roots are explicit request data, not grants. OpenForge does not show a picker, persist an allowlist, or claim OS-level sandboxing in API version 1. Plugins should obtain roots from clear product behavior or user configuration. The absolute root on each request makes the intended boundary reviewable and keeps child paths confined.

Backend plugins remain trusted Node code and may load Node built-ins. Direct `node:fs` access is technically possible, but it is not the supported host contract for user data, Project data, or configured external reads. Package-local code and Node dependencies may still require it.

## Consequences

- Plugins can keep non-JSON local data without inventing a home-directory layout.
- Cross-Project integrations can read one configured external tree without gaining a host write API for it.
- Frontend plugins remain limited to Project-scoped `openforge.fs` methods and cannot use Node filesystem APIs.
- `package.json#openforge.requires` remains declarative. Declaring `fs` does not create a runtime permission prompt.
- SDK fakes record backend user-data and external-read calls for plugin tests.
- Existing backend plugins should replace home-directory writes with `fs.userData` and configured external reads with `fs.external`. Direct `node:fs` calls that access OpenForge internals or another plugin's data remain unsupported.
