## Context

See `proposal.md` for motivation and `specs/video-previews/spec.md` for behavior.

The shared PR review package detects images by extension, fetches their old and new revisions as base64, renders a Before/After pair, and emits an image-open request. Task self-review wraps that package with an app-owned image lightbox. GitHub PR files and walkthroughs use the package directly, so they do not get that lightbox today.

The two content sources have separate binary paths. GitHub Sync requests base64 only for recognized images. Task self-review asks Rust for file revisions, and Rust base64-encodes only image paths; other binary bytes pass through lossy UTF-8 conversion. The File Viewer uses the public Plugin SDK `FileContent` contract and a separate Rust project-filesystem classifier. That classifier has typed image handling and a 1 MiB text/binary preview limit, but image payloads are currently unbounded.

Renderer CSP has no `media-src` directive. Its `default-src` therefore governs video elements and does not allow the HTTPS or data sources needed by existing and planned video players.

```text
                         +----------------------+
Task self-review ------->|                      |
GitHub PR files -------->| Shared Diff Viewer   |----> Shared media viewer
Walkthrough diffs ------>|                      |
                         +----------+-----------+----> Shared image viewer / native video controls
                                    |
                         typed revision content
                                    |
                  +-----------------+-----------------+
                  |                                   |
             local Git/Rust                    GitHub Sync

Project filesystem ---> Plugin SDK FileContent ---> File Viewer player
```

## Goals / Non-Goals

**Goals:**

- Keep media detection, Before/After presentation, image opening, native video playback, and accessibility consistent across every Diff Viewer caller.
- Reuse one discriminated review-media contract for images and videos.
- Prevent invisible video diffs and oversized selected files from moving unbounded base64 payloads into the renderer.
- Preserve existing text, Markdown, image, document, and unknown-binary behavior.
- Make playback failures explicit without attempting to infer codec support from the container extension.
- Keep filesystem access behind existing host-owned APIs.

**Non-Goals:**

- Transcoding, codec installation, poster generation, or video editing.
- Audio-only previews.
- Direct `file:` URLs, arbitrary remote media origins, downloads, or opening videos in an external application.
- Range-based streaming or a new media protocol in this change.
- Resolving Git LFS pointer files to their remote objects.

## Decisions

### Use one media descriptor for image and video diffs

Use a discriminated media item whose `kind` is `image` or `video`. Each item carries its source, filename, Before/After label, accessible description, and optional link action. Image gallery requests keep an ordered item list and active index; video items render directly in their Before/After section.

The shared extension-to-MIME table identifies images and videos and exposes media-level helpers. MP4 and M4V use `video/mp4`, WebM uses `video/webm`, OGV and OGG use `video/ogg`, and MOV uses `video/quicktime`. Rust classifiers mirror this table at command boundaries, with contract tests preventing case-sensitivity or MIME drift.

A discriminated contract keeps detection, source metadata, and rendering branches consistent without requiring a parallel video callback or application-owned video modal.

### Keep image viewing shared and use the native video player

The shared Diff Viewer owns its default image-open request and renders the shared full-window image viewer. An optional host callback may still override image opening. The app-owned image lightbox and its duplicated context tracking are removed or reduced to an adapter.

Video revisions render directly in their Before/After sections with `<video controls preload="metadata">` and no autoplay. They do not expose a separate application-owned full-window action; users rely on the native player controls, including Chromium's fullscreen control. An inline playback-error state preserves revision context and resets when the source changes. The shared full-window viewer accepts image items only, so a cross-media rename cannot navigate from an image into a dead custom video-player path.

This gives Task self-review, GitHub PR files, and walkthroughs identical behavior without threading modal state through each host. The image viewer retains fit/actual-size controls, gallery navigation, Escape handling, focus trapping, focus restoration, and stale-context cleanup. Electron grants native fullscreen only to the trusted main renderer and origin.

### Keep base64 transport, but load video diffs on demand and cap them

This change will reuse data URLs because all current review content APIs return strings and both committed revisions may exist only as Git blobs. Introducing a range-capable authenticated media service would be a much larger security and lifecycle change.

Video content will not join the current eager file-content batch. The file-content fetch state will track explicit requests, and a mounted visible video diff section will request its file once. The virtualized Diff Viewer therefore loads a video only when its section becomes relevant. Selecting a file already provides the equivalent demand boundary in the File Viewer.

Batch loading reserves each file's identity before dispatch and validates responses per file rather than with one global generation. A video requested while another batch is pending therefore starts a batch only for newly relevant files; the earlier response remains valid unless its own file identity or review basis changed.

Set an initial raw-video inline limit of 25 MiB per revision. Source adapters must determine or check byte size before base64 reaches the renderer. File Viewer returns its existing `large-file` shape with video MIME and size when the selected file exceeds the limit. Diff content results gain per-revision availability metadata so an empty revision can be distinguished from `missing`, `too-large`, and `load-failed` without parsing error strings. Existing `oldContent` and `newContent` fields remain usable for text and image callers during migration.

A custom streaming protocol would reduce memory and improve seeking, but it would require authenticated range handling for GitHub, temporary or virtual files for historical Git revisions, URL revocation rules, and another renderer trust boundary. The bounded base64 path is adequate for short review recordings and keeps this change finite.

### Encode recognized local media as bytes, never lossy text

Task self-review's Rust content conversion will classify image and video paths as binary media and base64-encode both old and new revisions. It will measure video bytes before encoding and return typed availability metadata when a revision exceeds the limit. Text behavior remains unchanged.

GitHub Sync selects text or base64 transport and the video size cap independently for the old and new filenames. Cross-media renames therefore preserve each revision's actual type. GitHub responses already include blob size at the host boundary; that size feeds the same per-revision availability result before the renderer receives content.

This avoids changing every file to base64, which would waste memory for normal source diffs and remove useful text semantics.

### Add `video` to the Plugin SDK file-content contract

`FileContent.type` gains `video`. For a previewable video, `content` contains base64 bytes, `mimeType` contains the mapped video MIME type, and `size` remains the original byte count. Oversized videos continue to use `large-file`, with their video MIME type preserved.

The project filesystem classifier gains a Video category and applies the video limit before reading the full file. The File Viewer adds a video branch with a native player, metadata, an error state driven by the media element, and teardown when file identity changes.

Because expanding a public discriminant can break exhaustive consumer switches, the Plugin SDK migration guide, public type tests, fakes, package contract checks, and release metadata must document the new case. Host and built-in File Viewer artifacts must ship together.

### Add a narrow media CSP directive

Renderer CSP will add:

```text
media-src 'self' https: data: blob:
```

The directive is media-only and does not add `file:`. Existing `img-src`, `connect-src`, and script restrictions remain unchanged. The main renderer's Electron permission handler grants `fullscreen` only when the request comes from the trusted main web contents and renderer origin; other renderers, origins, and unrelated permissions remain denied. Security tests assert both boundaries.

HTTPS is required for GitHub-hosted recordings already rendered from Markdown. Data supports the bounded base64 previews in this change. Blob permits object URLs if a renderer converts a bounded base64 payload to a Blob to reduce repeated data-URL copies; it does not grant filesystem access.

## Risks / Trade-offs

- [Base64 increases memory by roughly one third and may be copied across IPC and renderer state] -> Load video diffs only when visible, cap each raw revision at 25 MiB, release stale content when file identity or review basis changes, and keep a future streaming protocol outside this change.
- [A recognized container may use a codec Chromium cannot decode] -> Treat extension detection as eligibility only, listen for player errors, preserve metadata, and show a playback-unavailable message.
- [Native fullscreen could broaden renderer privileges if granted indiscriminately] -> Grant `fullscreen` only to the trusted main web contents and renderer origin; keep unrelated permissions and untrusted requests denied.
- [TypeScript and Rust extension tables may diverge] -> Cover the same extension and MIME matrix in shared UI, GitHub adapter, project filesystem, and self-review boundary tests.
- [The new Plugin SDK discriminant can break exhaustive consumers] -> Mark the proposal as breaking, update migration documentation and package contract tests, and release the SDK with the host and built-in plugin.
- [Allowing HTTPS media broadens renderer fetch behavior] -> Scope the CSP change to `media-src`, retain the existing trusted renderer and navigation policies, and explicitly reject `file:` in tests.
- [GitHub may omit or reject large blob content before OpenForge can classify it] -> Map host API size or content failures to the typed unavailable state and keep the existing retry path for transient failures.

## Migration Plan

1. Add media types, detection helpers, availability metadata, and tests without changing rendered behavior.
2. Update local and GitHub content adapters to return bounded video revisions and preserve existing text/image results.
3. Move image viewing into the shared review package, remove app-only lightbox state, and render review videos with native inline controls.
4. Extend the Plugin SDK and project filesystem contract, update documentation and fakes, then add File Viewer rendering.
5. Add the media CSP directive and its security tests before enabling production video sources.
6. Build the Plugin SDK and bundled plugins, then run full checks for the shared review package, GitHub Sync plugin, File Viewer plugin, renderer, Electron trust policy, IPC contracts, and Rust crate.

Rollback requires reverting the host, shared UI, built-in plugins, and Plugin SDK artifacts as one release unit. Once an SDK containing the `video` discriminant is published, later releases should retain the discriminant even if the built-in preview UI is temporarily disabled.
