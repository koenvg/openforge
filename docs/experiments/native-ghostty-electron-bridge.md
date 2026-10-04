# Native Ghostty Electron bridge prerequisites

This document records the earlier prerequisite stage. The user approved a dev-only in-process Electron addon exception to ADR 0005, with xterm as the default and the backend as sole protocol responder. **The subsequent production integration is described in [existing-session findings](native-ghostty-existing-session.md)**; its evidence and remaining blockers supersede the "not wired" status below.

Baseline before integration: `855d845547eaeb8e7625599b15d1a308883ba70a`.

## Codec compatibility first

The first fixture exported by OpenForge's pinned libghostty-rs dependency failed in the previous experimental native fork. The decoder raised `PayloadNotExhausted` at READY. Production Ghostty `22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018` uses BLAKE3-protected READY/FINISH records. The newer experimental revision `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c` expects empty marker payloads.

Rather than strip checksums or change the backend pin, this experiment rebases the native host/window changes onto the production revision. The only patch merge conflict was the newer allocator-owned default palette initialization, which does not belong in the older implementation. The older constructor retains its existing palette initialization.

The production-codec fixture now passes. It contains 2,000 Unicode history lines and ends inside a CSI sequence. The native owner adopts READY, finishes the sequence with live output, advances history and retains `READY-BACKENDLIVE`. This establishes compatibility for this fixture at one shared revision, not general cross-version compatibility or image recovery.

## Input and reply ownership

Native I/O now distinguishes user-originated writes from protocol responses before enqueueing bytes. Keyboard, text, mouse and user bindings take the input route; native reports, title replies and OSC clipboard responses do not. The hosted backend can suppress ordinary writes without suppressing input. The Electron addon always disables native replies.

The headless test covers suppression plus the surviving user-input route. A real native Surface/C probe sends terminal queries, focus/resize reports, text input and a key event. Before input routing was added, it received zero bytes and failed. It now receives exactly `typeda`, six bytes, through the native I/O callback. This proves native suppression and input forwarding, not end-to-end backend reply delivery.

## Electron boundary

The retained Objective-C++ N-API addon attaches a native Ghostty NSView to Electron's BrowserWindow handle. It accepts copied snapshots and fenced output, exposes incremental history, and retains callback userdata until native thread shutdown. N-API thread-safe callbacks preserve input bytes and filter destroyed attachment identities. IDs are separate from host owner tokens.

The Electron test verifies a checkpoint replacement, malformed replacement preserving the old owner, stale/gapped output rejection, five adoption/destruction cycles, repeated destruction, exact text callback contents and a resize call. An initial empty Buffer incorrectly became a non-null zero-length snapshot; the native constructor rejected it. Empty snapshots now use a null pointer, and the test passes.

This is a hidden test window. No screenshot, pixel, interaction, latency or presented-output claim follows from these checks. Native offsets acknowledge parsing and restart at zero for each new owner. They are not backend model sequence numbers.

## Retained implementation and checks

See [the experiment README](../../scripts/experiments/native-ghostty-openforge/README.md) for commands and limitations. The complete patch applies directly to the production Ghostty revision and records 18 resulting source hashes. It is separate from the earlier [native window experiment](native-ghostty-window.md), whose source and historical evidence remain unchanged.

The final explicit-Node `--full` runner passed:

- Rust fixture generation, Rust formatting and fixture-bin Clippy with warnings denied.
- Zig formatting and 82/82 focused tests.
- Native Metal library build, 98/98 steps.
- Objective-C and Objective-C++ builds with `-Wall -Wextra -Werror`.
- Native authority probe and real Electron/N-API test.
- Full native suite: 3,326 passed, 16 skipped out of 3,342; 84/84 build steps. The full command took 319,668 ms. Individual skip names were not emitted.

Explicit Node syntax checks passed. A clean local clone at the production pin accepted the retained patch and matched all 18 tested hashes; preparation used 38 cached packages. This is source reproduction using local Git objects/caches, not an independent hardware rebuild or a second network bootstrap.

A symlinked `uucode` generator package initially caused `FileNotFound` for its relative executable path. Materializing that package fixed the build. Preparation copies cached packages instead of introducing those symlinks.

Durable prerequisite logs, red tests, hashes and the historical report are in [the evidence directory](../../scripts/experiments/native-ghostty-openforge/evidence/). At this stage production code had not changed, so production subsystem checks were not rerun. Current integration checks are recorded separately in [existing-session findings](native-ghostty-existing-session.md).

## Integration work identified at this stage

1. Export an eligible binary checkpoint at an atomic backend recovery watermark. The existing desktop recovery contract is portable VT, compatibility replay and continuation, not this binary payload. Keep image-bearing/otherwise lossy snapshots fail-closed.
2. Add typed desktop wrappers and the opt-in Runtime view adapter. Keep Terminal Runtime's existing PTY/session ownership; do not spawn a replacement shell for this experiment.
3. Preserve input bytes across desktop IPC. The existing string-based input contract must not silently decode arbitrary native bytes as UTF-8.
4. Map attachment generation, PTY instance, model sequence and native byte offset explicitly. Handle output buffered during adoption, resizes, reconnects, failures and teardown.
5. Add main-process ownership of BrowserWindow close/navigation cleanup. Never accept native window pointers from renderer IPC. Address geometry, scaling, overlay visibility and explicit xterm fallback before exposing the view.
6. Complete visual acceptance. Screen Recording permission was unavailable in the prior stage. Clipboard, IME, accessibility, app shortcuts and image transfer remain open.
7. Run affected production subsystem checks and the required fresh completion review once the integration exists.

Cleanup remains in KVG-5225 for the upstream search-thread teardown test, KVG-5214 for contradictory ADR guidance, and existing KVG-5201 for presentation accounting. None is fixed by this bridge.
