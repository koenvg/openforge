## 1. Shared Media Contracts and Loading

- [x] 1.1 Add failing shared PR review tests for case-insensitive MP4, M4V, WebM, OGV, OGG, and MOV detection and MIME mapping, then replace image-only helpers and request types with a discriminated image/video media contract; verify the focused media-helper tests and `pnpm --filter @openforge-app/pr-review-ui check` pass.
- [x] 1.2 Add failing fetch-state tests for explicit video requests, one-time loading, staggered requests during an in-flight batch, retry, stale-context eviction, and per-revision `missing`, `too-large`, and `load-failed` metadata, then implement demand-driven video loading with per-file in-flight identity tracking without changing eager text/image behavior; verify the focused fetcher tests and PR review UI typecheck pass.

## 2. Review Content Sources

- [x] 2.1 Add failing Rust self-review tests for every supported video extension, case-insensitive matching, base64 preservation, absent revisions, and the 25 MiB per-revision limit, then return typed availability metadata instead of lossy video text; verify the focused `self_review_runtime` Cargo tests pass.
- [x] 2.2 Add failing renderer IPC and self-review loader tests for the new revision availability result, then update typed wrappers and adapters while preserving existing text/image consumers; verify the focused loader tests and `pnpm electron:contract:check` pass.
- [x] 2.3 Add failing GitHub Sync tests for old/new video revisions, per-side cross-media rename classification, media base64 selection, size-limit results, missing sides, and retryable failures, then make PR-file and walkthrough loaders choose transport and limits from each revision filename and return typed availability metadata; verify `pnpm --filter @openforge-app/plugin-github-sync test` passes.

## 3. Shared Diff Viewer Media Presentation

- [x] 3.1 Move the image lightbox behavior into a shared package-owned media viewer test-first, preserving image fit, actual-size, gallery navigation, Escape, focus restoration, and stale-context behavior; verify the migrated image-lightbox tests pass from every existing Task self-review call site.
- [x] 3.2 Add failing video tests for native controls, no autoplay, Before/After labels, inline codec-error feedback, and error reset on source changes, then render discriminated video items directly in their review sections and keep the shared full-window viewer image-only; verify the focused tests and PR review UI typecheck pass.
- [x] 3.3 Add failing Diff Viewer tests for modified, added, removed, renamed, and cross-media-renamed videos plus loading, too-large, missing, failed, and retry states, then classify each side independently and render visible video sections with native controls, no separate full-window action, and no absent-side player; verify the focused shared Diff Viewer tests pass.
- [x] 3.4 Add or update integration tests proving Task self-review, GitHub PR file review, and walkthrough diffs all receive the package-owned image viewer and native inline video player, then remove obsolete app-only lightbox state and callbacks; verify the focused renderer and GitHub integration tests pass.

## 4. Plugin SDK and File Viewer

- [x] 4.1 Add failing Plugin SDK contract tests for `FileContent.type: 'video'`, base64 content, MIME type, byte size, large-file fallback, and video file icons, then update public types, fakes, exports, release metadata, and the file API migration guide; verify `pnpm --filter @openforge-app/plugin-sdk test`, `pnpm packages:contract:check`, and `pnpm packages:metadata:check` pass.
- [x] 4.2 Add failing Rust project-filesystem tests for all supported video extensions and MIME types, case-insensitive classification, bounded reads, and `large-file` results above 25 MiB, then implement the Video classification path without changing other file categories; verify the focused `project_fs` Cargo tests pass.
- [x] 4.3 Add failing File Viewer tests for selected-video metadata, native controls, no autoplay, decode errors, large-file fallback, playback stop on selection change, and existing image/text regressions, then implement the in-pane video preview; verify `pnpm --filter @openforge-app/plugin-file-viewer test` and its bundle build pass.

## 5. Renderer Trust Policy

- [x] 5.1 Add failing Electron trust-policy tests for `media-src 'self' https: data: blob:`, the continued absence of `file:`, and native fullscreen restricted to the trusted main renderer and origin; then add the narrow media directive and fullscreen grant without relaxing other policies; verify the focused trust-policy tests, `pnpm electron:contract:check`, and the renderer build pass.

## 6. Affected-System Validation

- [x] 6.1 Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm --filter @openforge-app/pr-review-ui check`, the Plugin SDK build and contract checks, both affected plugin bundle builds, and the root renderer build; record all command results and any skipped coverage.
- [x] 6.2 From the backend crate root run `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; then run `pnpm electron:contract:check` and `openspec validate add-video-preview-support --strict`, and record results plus any remaining codec or manual-playback gaps.
