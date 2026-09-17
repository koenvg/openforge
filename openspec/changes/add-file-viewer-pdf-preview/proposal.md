## Why

The File Viewer identifies PDFs but cannot display them because the shared file-preview contract deliberately returns document metadata with empty content. PDF support needs a bounded, authorized document-read capability before a renderer can safely use it.

## What Changes

- Add an explicit document-byte read for project files and resolved task workspaces through the host, typed desktop IPC, and Plugin SDK. Keep existing `FileContent` document responses metadata-only.
- Limit each PDF to 16 MiB and bound concurrent reads. Authorize paths from host-resolved roots, reject unsafe paths and symlink traversal, and define file-change, timeout, and teardown behavior.
- Use locally bundled PDF.js with a real worker, selectable text and document structure support. Do not expose local file URLs or execute document actions.
- Add single-page navigation, fit-width and percentage zoom, accessible loading and error states, and deterministic cleanup when selection or workspace changes.
- Cover backend authorization and read limits, cross-runtime API contracts, worker packaging and trust policy, UI behavior, accessibility, and resource release.

## Capabilities

### New Capabilities

- `bounded-document-preview`: Authorized, size-limited document bytes for trusted frontend and backend plugin consumers, including compatibility and lifecycle guarantees.
- `file-viewer-pdf-preview`: Accessible PDF navigation and rendering in project and task File Viewers.

### Modified Capabilities

None. Existing video preview requirements remain unchanged. PDF support is additive and does not change the meaning of `FileContent.content`.

## Impact

- Rust document-read module, project and task filesystem handlers, app-invoke dispatch, and plugin-host callbacks.
- Typed IPC commands and generated registry, Plugin SDK types and test fixtures, frontend host adapters, and backend runtime capability mapping.
- File Viewer workspace adapter, preview controller, a dedicated PDF preview module, build assets, and Electron worker/CSP tests.
- A pinned `pdfjs-dist` dependency, matching worker and font/CMap resources, plugin stylesheet registration, and SDK authoring documentation.
- No database migration. No PDF support in Diff Viewers, historical revisions, remote URLs, external filesystem APIs, or mobile in this change. No editing, forms, printing, OCR, attachments, or password entry.

## Follow-up

KVG-5072 tracks the existing unbounded image preview read in `project_fs.rs`. It is separate from this proposal and depends on KVG-3923.
KVG-5074 tracks check-then-open path races in existing non-document preview reads. The new document capability must be secure independently; migrating older readers remains separate follow-up work.
