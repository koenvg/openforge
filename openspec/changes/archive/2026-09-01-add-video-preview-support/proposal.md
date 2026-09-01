## Why

Changed videos are currently treated as unsupported binary files, so reviewers cannot inspect recordings alongside code changes. The File Viewer has the same gap, which forces users to leave OpenForge to verify a project video.

## What Changes

- Add browser-playable video detection and previews to every shared Diff Viewer integration, including Task self-review, GitHub PR files, and walkthrough diffs.
- Show added, removed, modified, and renamed videos in the existing Before/After review layout with native playback and fullscreen controls.
- Generalize the image-only review media contract and lightbox so images retain consistent navigation, focus handling, stale-context cleanup, loading, and error recovery while review videos use their native player controls.
- Add video previews to the File Viewer plugin with file metadata and a safe fallback for oversized or unplayable content.
- Update the renderer content security policy so approved HTTPS, data, and blob video sources can play without granting filesystem access.
- **BREAKING**: Extend the public Plugin SDK `FileContent.type` union with `video`; plugin consumers with exhaustive handling must add the new case.

## Capabilities

### New Capabilities
- `video-previews`: Detect, load, display, and open project and review videos across Diff Viewer integrations and the File Viewer plugin.

### Modified Capabilities

None.

## Impact

- Shared PR review UI media detection, content fetching, rendering, exports, and tests.
- Task self-review media transport and its Rust command boundary.
- GitHub Sync file-content loading for current and base revisions.
- File Viewer UI and the public Plugin SDK file-content contract and documentation.
- Project filesystem preview classification and binary encoding.
- Electron renderer CSP and its security contract tests.
- No new runtime dependency is expected; playback remains subject to Electron/Chromium codec support.
