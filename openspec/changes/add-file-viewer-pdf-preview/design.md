## Context

See `proposal.md` for motivation and scope. This is a proposed design, not an implementation report.

Observed contracts:

- `src-tauri/src/project_fs.rs` classifies `.pdf` as `Document` and returns empty content. `read_file_preview` has a 1 MiB text limit and a separate 25 MiB video limit. Neither is a document-byte interface.
- `packages/plugin-sdk/src/domain.ts` documents empty content for unavailable categories. `FileSystemAPI.readFile` and `TaskFileSystemAPI.readFile` return that `FileContent` type.
- `plugins/file-viewer/src/lib/workspaceSource.ts` already separates project and task identities. Task reads use the resolved live workspace, not the project checkout as a fallback.
- Frontend calls pass through `runtimeCommonApi.ts`, `pluginHostProjects.ts`, typed wrappers exported by `src/lib/ipc.ts`, and `app_invoke/files_review.rs`. Backend plugins use the runtime bridge and `plugin_host/filesystem_callbacks/{project,task}.rs`. Both ultimately read through `project_fs`.
- Existing path resolution canonicalizes a path before opening it. The new byte capability must not rely on a check-then-open sequence that permits symlink replacement races.
- File Viewer is a trusted frontend plugin, not a host-owned component. Its current `FileContentViewer.svelte` only renders the metadata-only document state. Its Vite build currently declares one frontend entry and no PDF worker or styles.
- Electron's renderer policy allows scripts from `self` and `plugin:`, but does not explicitly declare `worker-src`. Its `connect-src` does not currently include plugin assets. PDF.js packaging needs an explicit, tested policy rather than a development-only workaround.
- Trusted plugins are not sandboxed, and `requires` is a capability declaration rather than a permission prompt. This design secures the document-read interface against untrusted file contents and caller-controlled paths. It does not claim to sandbox malicious trusted plugins.

## Goals / Non-Goals

Goals:

- Put authorization, bounded reads, and wire semantics behind one document-read module shared by the project/task and frontend/backend adapters.
- Put PDF loading, render cancellation, page resources, text accessibility, and teardown behind one PDF preview module. Keep `FileContentViewer` responsible for selecting the preview kind.
- Make the public interface and visible behavior the test seams. Test file authorization through real filesystem fixtures and transport behavior through each real adapter.

Non-goals:

- No general file-server, document session registry, arbitrary byte reader, or replacement for the existing text/image/video contract.
- No automatic loading of every PDF in a directory, persisted PDF bytes, or retained PDF documents for inactive tabs.
- No promise that scanned or untagged source PDFs have accessible semantic structure. No OCR or document remediation.

## Decisions

### 1. Separate one-shot document bytes from metadata

Add `fs.readDocument(request: ProjectScopedFileRequest)` and `fs.task.readDocument(request: TaskScopedFileRequest)` to the common SDK interface for frontend and backend consumers. The host exposes corresponding typed desktop commands `fs_read_document` and `task_fs_read_document`, with camelCase `projectId` or `taskId` and `filePath` payload fields. SDK requests retain the existing `path` naming and adapters translate it, just as current file reads do.

The result is an additive JSON union, exported through the public SDK:

```ts
type DocumentPreviewRead =
  | {
      status: 'ready'
      mimeType: 'application/pdf'
      encoding: 'base64'
      data: string
      size: number
      revision: string
      modifiedAt: number | null
    }
  | {
      status: 'unavailable'
      reason: 'too-large' | 'unsupported-format' | 'invalid-document'
      size: number
      maxBytes: number
    }
```

`size` is the raw byte count, never base64 length. `revision` is an opaque digest of the returned bytes, not a path, authorization token, or a promise that disk contents will remain unchanged. `modifiedAt` is the observed file timestamp. Unavailable results contain no bytes. Rust command seams retain `Result<T, String>` conventions. Missing file/workspace, forbidden path, detected concurrent change, busy admission, timeout, and I/O errors reject with stable documented prefixes and sanitized user-readable messages. The UI does not parse operating-system error text to determine policy failures.

Error prefixes are `DOCUMENT_PREVIEW_NOT_FOUND`, `DOCUMENT_PREVIEW_FORBIDDEN`, `DOCUMENT_PREVIEW_CHANGED`, `DOCUMENT_PREVIEW_BUSY`, `DOCUMENT_PREVIEW_TIMEOUT`, `DOCUMENT_PREVIEW_IO`, and `DOCUMENT_PREVIEW_UNAVAILABLE_HOST`. Malformed requests use `DOCUMENT_PREVIEW_BAD_REQUEST`. Missing task workspaces use the not-found category. Messages must not expose absolute host paths. An app transport failure still uses its existing transport-error handling rather than masquerading as a document policy result.

`FileContent` does not gain a `pdf` case and its document content stays empty, including for oversized PDFs. The document read independently authorizes and inspects the file; a prior metadata read does not grant authority. Callers cannot provide a MIME type, root path, byte limit, or URL. PDF selection requires the existing `document` classification and `application/pdf` MIME type. The new reader checks case-insensitive `.pdf` and a PDF header in the first 1,024 bytes. Header validation is only format screening; the parser still treats every byte as hostile.

Alternatives considered:

| Choice | Benefit | Reason not chosen |
| --- | --- | --- |
| Put base64 into existing `FileContent.content` | Few UI changes | Violates the documented empty-document contract and makes ordinary metadata reads unexpectedly expensive. |
| Capability URL with range requests | Efficient large-document reads | Requires an origin policy, range validation, token ownership, expiry, revocation, and a file identity strategy. Unnecessary for bounded v1 previews. |
| Open/read/close stream handles | Smaller wire messages | Adds persistent host resources, crash recovery, and cancellation ordering. Defer until measured file-size needs justify it. |
| Arbitrary `file:` URL or embedded native PDF viewer | Less rendering code | Exposes filesystem authority and leaves controls, accessibility, lifecycle, and security behavior to opaque browser UI. |

One-shot JSON bytes fit the existing transport and avoid persistent host capabilities. Base64 overhead is explicit: a 16 MiB document encodes to at most 22,369,624 characters, plus a small envelope. Contract tests must pass that exact maximum through the real app-invoke and backend plugin transports. Do not silently raise a generic IPC size limit to make a test pass.

### 2. Authorize the actual file read

The document-read module accepts a host-resolved workspace root and a relative path. Each adapter resolves the root from persisted project/task identity. Task resolution retains its existing unavailable-workspace failure instead of falling back to the project directory. Keep existing trusted-renderer/authenticated app-invoke admission and trusted plugin-host admission. Do not add an unauthenticated HTTP route, companion/mobile action, or external-filesystem overload.

Reject empty paths, absolute paths, drive/UNC forms, NULs, URL forms, and parent traversal components. Do not percent-decode paths. Only regular files qualify. Reject symlinks and platform reparse points in descendant components for this new capability, including links whose targets are within the root. Existing preview behavior is not changed by this stricter rule.

Open the host-selected root as a directory capability, then open descendants relative to pinned directory handles with no-follow semantics. Keep those handles alive until opening the final regular file. Use an audited capability-relative filesystem primitive with equivalent platform guarantees; a lexical check or canonicalize-then-open is not sufficient. A replaced component must fail or remain bound to the already authorized object, never redirect to an outside file. The root itself comes from trusted project/workspace resolution and is pinned for the read. Verify workspace identity again before publishing bytes; reject if the task root changed or the project/task disappeared. On unsupported platforms, fail closed rather than use a weaker open path.

Inspect size/type on the opened file handle. Read at most `MAX_DOCUMENT_PREVIEW_BYTES + 1`, where the maximum is 16,777,216 bytes. Reject oversized metadata before allocation and reject growth beyond the limit during reading. Compare handle metadata before and after the read to reject observed size/time changes. Return a digest for the captured byte buffer. This is not a transactional snapshot against a writer that can forge metadata; corrupt or inconsistent bytes remain subject to PDF parser validation and resource limits. The security guarantee is containment and bounded I/O, not cooperation from a writer.

A shared host admission controller allows two in-flight document reads across all adapters, with no waiting queue. Excess calls reject as busy and offer manual retry. The slot covers reading, encoding, and response construction. Apply a 15-second read deadline, close handles and release the slot on all exits, and stop reading when host request cancellation is available. If the bridge cannot cancel an already dispatched request, it may finish within its byte/time bound; the caller discards the stale response. The caller never loops retries automatically.

### 3. Own bytes and renders by logical identity

The File Viewer workspace adapter gains `readDocument(path)` and hides project/task routing. A dedicated PDF preview controller owns the request generation, byte decoding, PDF.js loading task, worker, current page, and render task.

Logical identity includes workspace identity, relative path, observed modification metadata, and an explicit reload generation. Compare identity explicitly when inputs change. Do not release prop-keyed resources from reactive-effect cleanup. `onDestroy` releases the current owner once.

- Load document bytes only for the currently visible selected PDF. Keep at most one document and one active page render per viewer instance.
- On selection/workspace change, pane hide, plugin deactivation, retry, or unmount, invalidate the generation before cancelling work. A late result cannot restore an old document or overwrite a newer status.
- Cancel page rendering, destroy the PDF loading task/document, terminate the owned worker, revoke its worker Blob URL, clear text/structure layers, release canvas backing memory, and drop base64/byte references. Teardown is idempotent even during worker startup or failed parsing.
- Pass decoded `Uint8Array` data to PDF.js and transfer it to the worker. Drop the base64 string after decoding; never keep it in persisted view state or logs. No PDF Blob URL is created.
- Page or zoom changes cancel only superseded page work. They do not reread the file. Retry starts a fresh authorized read; it is not reuse of a failed buffer.
- Page and zoom state remain local to the active preview. New file, workspace, or reload starts on page 1 at fit width. No PDF session persistence is introduced.

Returned bytes cannot be revoked from a trusted caller that already received them. There is no server handle to expire or close. Authorization is checked on each new read; File Viewer discards bytes when their owner ends.

### 4. Use PDF.js with explicit active-content restrictions

Choose Mozilla PDF.js through a pinned, supported `pdfjs-dist` release. It supports local bytes, worker parsing, selectable text, and structure-tree accessibility. Use its display and page-view facilities rather than embedding the generic full viewer or writing a canvas-only renderer. Keep canvas, text-layer positioning, and tagged-document structure synchronized at every zoom. Hide redundant canvas content from assistive technology when the text layer supplies the page content.

Use `getDocument` with `data`, an explicitly owned real worker, `isEvalSupported: false`, and `enableXfa: false`. Disable document scripting, forms, embedded attachments, automatic document actions, and interactive annotation actions. Do not implement PDF link navigation in v1. Annotation appearances that are already part of the page may render, but document-provided targets never initiate requests, app navigation, downloads, or external opens. Any later external-link feature must use the existing host `openUrl()` capability and its URL policy.

Ship the exact matching worker with the plugin. Bundle the worker as self-contained source and create an owned module worker from a Blob; do not rely on PDF.js's cross-origin wrapper or fake-worker fallback. Add an explicit `worker-src 'self' blob:` directive to the trusted renderer CSP. Keep script evaluation restrictions and the untrusted renderer policy unchanged. Worker startup failure is a recoverable preview error, not a reason to parse on the UI thread.

Package matching CMaps, standard fonts, and required decoding resources locally. Configure their base URLs from the installed plugin entry, not document content. Permit `plugin:` asset fetches through the trusted renderer's `connect-src` only with existing package-root containment and traversal tests retained. No `https:` wildcard, CDN, `file:`, or arbitrary localhost access is added. Register emitted PDF text-layer styles in `frontendStyles`; test installation of built artifacts, not just the source Vite server. Resources use the same pinned release as the library and worker. Record that release and license notices when applying the proposal.

Sources consulted:

- https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
- https://mozilla.github.io/pdf.js/api/draft/api.js.html

These document data transfer, worker ownership, cancellation, structure trees, and resource options. They are draft docs; implementation must verify exact option and page-view interfaces against the pinned release and must not import private internals to bypass a mismatch.

### 5. Bound rendering separately from byte transport

A small compressed PDF can still consume large amounts of memory. Transport limits alone are insufficient.

- Support at most 2,000 pages. Reject higher page counts before rendering pages and display a page-limit explanation.
- Render one page at a time, without thumbnail generation or adjacent-page prefetch. Keep at most one active render and release previous page resources.
- Cap the page canvas at 16,777,216 physical pixels and each dimension at 8,192 pixels. Cap embedded-image decoding through the supported PDF.js image-size option at 16,777,216 pixels. Never allocate an unbounded canvas from PDF dimensions or device pixel ratio.
- Reduce backing resolution while preserving CSS zoom when the canvas cap would be exceeded and show a reduced-resolution notice. If a page cannot render within the limits, show a page-specific resource error rather than allocating more memory.
- Apply a 30-second load/parse deadline and a 15-second page-render deadline. Cancellation destroys the worker on timeout. These bounds do not imply a hard process-wide JavaScript heap quota. Record peak memory and teardown behavior using compressed-image and many-page fixtures before release.

### 6. Page, zoom, loading, and error interaction

Keep filename, MIME type, byte size, modification metadata, and the existing return-to-tree action visible. A wrapping PDF toolbar sits below that header and outside the page scroller. At a 320 CSS-pixel pane width and 200% application zoom, controls wrap in reading order rather than disappear or require horizontal toolbar scrolling.

The toolbar contains Previous page, an explicitly labeled page-number input, total pages, Next page, Zoom out, a zoom value control, Zoom in, and Fit width. Use SDK controls and existing tokens. All controls have visible focus and accessible names; do not rely on icon tooltips as their names.

- Start at page 1 and fit width. Navigation accepts whole page numbers from 1 through N, committed by Enter or blur. Invalid input leaves the current page unchanged, shows an inline validation message, and permits correction. Disable Previous/Next at the endpoints.
- Percentage zoom ranges from 25% through 400% in 25-point button increments. Manual entry accepts whole percentages in that range. Fit width recomputes on pane resize, clamped to the same range. Show horizontal page scrolling when the minimum zoom still cannot fit. Manual zoom survives pane resizing until Fit width is chosen.
- Keyboard users reach every control with Tab and activate native button behavior. Do not capture app-wide arrow keys, Page Up/Down, or browser zoom shortcuts. Keep keyboard focus on the control used; rendering never steals focus. The existing return-to-tree action works in every state.
- Distinguish file-read, document-parse, and page-render loading states using a visible message and polite status announcement. Do not announce metadata as a successfully rendered PDF. No invented percentage progress for a one-shot read.
- On page changes, clear the stale page before showing the pending page. Announce the current page and total only once the requested page is ready. Disable controls that need the page count until parsing succeeds.
- Read errors, missing workspaces, denied paths, corrupt/empty PDFs, worker failures, timeouts, and page failures keep metadata visible and offer a bounded manual Retry. Unsupported documents, PDFs over 16 MiB, more than 2,000 pages, and password-required PDFs show specific unavailable messages. No password is requested or stored. No automatic retry loop.
- Tagged PDFs expose their available reading structure. Untagged PDFs expose selectable text in extracted order with a reading-order limitation notice. Pages with no extractable text show a visible and announced notice that text content is unavailable. Do not claim OCR or full accessibility of scanned documents.

### 7. Test seams and verification scope

Use test-first slices in platform-to-UI order. The public SDK read interface, authenticated app-invoke commands, Rust document-read module, workspace adapter, and visible PDF controls are the seams.

Backend tests use real temporary roots and files for relative paths, traversal, absolute/UNC/URL inputs, outside and inside symlinks, component-swap races, special files, deleted files, task root changes, exact/over-limit bytes, growth during read, metadata-only compatibility, busy admission, deadline cleanup, and no-byte policy failures. Where platform APIs differ, run the relevant containment fixtures on each supported desktop OS; unsupported secure-open adapters fail closed.

API-contract tests cover both project and task routes through frontend and backend plugins, camelCase payloads, exact base64 byte round trips, ready/unavailable results, stable error prefixes, SDK mocks, disabled/unavailable capabilities, generated command registries, and the maximum response envelope. Preserve existing text/image/video/document assertions. Scope IDs select the root; a request path cannot select another root. Trust-policy tests reject untrusted renderer requests and confirm no new unauthenticated route exists.

UI tests use deterministic renderer fixtures for controls, endpoint validation, zoom bounds, fit-width resize, status/error announcements, metadata retention, keyboard focus, text/structure layers, password and scanned-document states, lazy loading, stale responses, rapid file/workspace changes, retry, and every teardown entry point. Add a real PDF.js browser integration test so mocks cannot hide worker, font, CMap, text-layer, or CSP failures. Assert no document-triggered network, file, or navigation action. Include multilingual, tagged, untagged, image-only, corrupt, oversized, high-page-count, compressed-image, and pathological-page-size fixtures. Test both project and task views, including hidden panes and plugin unload.

Because this crosses public contracts, dependencies, lifecycle code, and renderer trust policy, implementation requires full affected-system checks, not only `FileContentViewer.test.ts`:

- File Viewer: `pnpm --filter @openforge-app/plugin-file-viewer test` and `build`.
- Plugin SDK: `pnpm --filter @openforge-app/plugin-sdk test`, `build`, `check:entrypoints`, and `check:contract`.
- App renderer/Electron and runtime integration: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm packages:metadata:check`. `packages/plugin-runtime` has no package scripts; include any affected runtime tests through their owning runner and disclose gaps.
- Backend crate, located with `node scripts/rust-sidecar-layout.mjs backend-crate-root`: `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` as documented in `CONTRIBUTING.md`.
- Build/install the plugin and run a packaged Electron PDF smoke test under production CSP. Use existing browser test infrastructure for automated checks. Use Koen's connected Arc session for manual browser checks and ask for connection help rather than switching browsers. Perform keyboard and screen-reader review of a tagged PDF and the scanned-document fallback.

Report skipped checks, supported-OS coverage, memory observations, and any manual accessibility gap. Do not include unrelated website, mobile, or terminal package validation unless the eventual diff affects them.

## Risks / Trade-offs

- Base64 copies and decompression pressure: the 16 MiB read cap, admission control, one-page rendering, image/canvas limits, and teardown tests reduce exposure. They are not a hard Electron heap sandbox.
- Denying descendant symlinks excludes some otherwise readable repository PDFs: show a clear unavailable explanation rather than weakening path containment. A future safe-link policy is separate work.
- PDF.js APIs and asset packaging vary by release: pin matching artifacts, verify public interfaces, and test the installed plugin under production CSP before release.
- Blob workers and plugin asset fetches widen two trusted-renderer CSP directives: make those changes explicit and regression-test untrusted origins and filesystem URL denial. Do not enable unsafe script evaluation.
- Text layers do not repair inaccessible source PDFs: disclose untagged reading-order and missing-text limitations, and validate tagged content with assistive technology.
- Header and metadata checks cannot guarantee a well-formed or atomically captured PDF: treat parser input as untrusted and fail visibly without retries or authority escalation.

## Migration Plan

1. Land the secure document-read module and platform contracts with compatibility tests, while the existing File Viewer still shows metadata-only documents.
2. Add SDK/runtime adapters and test fixtures. Document the new additive methods, size policy, stricter symlink policy, and unavailable-host behavior. Existing plugin consumers retain their old read semantics.
3. Add the File Viewer controller and PDF.js package, worker/resources/styles, followed by the explicit trust-policy changes and packaged tests. Do not expose the viewer before the secure host path exists.
4. Release matching host, SDK, and built-in plugin artifacts together. On an older host without the new capability, the plugin shows metadata and an unavailable-host message instead of falling back to raw filesystem access.
5. Roll back PDF rendering independently by restoring the metadata-only UI and worker/CSP additions. The additive host method can remain unused. No stored data or database migration needs reversal.
