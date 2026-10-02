# Screen before history, KVG-5251

## Result and scope

This is a fixture-based vertical slice, not an agent or PTY integration test. The candidate displays the current Ghostty screen and accepts the controlled `k` key while every older page is withheld. Releasing the 16-row plain-text page makes history scrollable without changing any live cell or the cursor. Both panels are real xterm DOM renderers.

Everything lives in this directory. No production build, renderer, shared dependency, Terminal Runtime API, live session, or KVG-5198 native experiment changes. The baseline uses official unpatched xterm with the current concealment policy reproduced by the small adapter, not the production app itself.

## Run in your existing Arc session

From the repository root, with Node 24.14.0 and pnpm available:

```sh
node scripts/experiments/xterm-screen-first/launch.mjs
```

This verifies that the existing debugging endpoint is reachable, installs only this directory's locked dependencies, rebuilds both renderers, serves the frozen fixture, and opens one tab in that browser. It never launches a browser or replaces the shared xterm package. First build needs network access to fetch official source; later builds reuse the verified archive. Ctrl-C stops the server, not Arc.

`ARC_CDP_URL` defaults to `http://127.0.0.1:9222`. It must point to your existing Arc session. `SCREEN_FIRST_PORT` defaults to `5251`. If Arc is unavailable, connect it rather than starting another browser.

The fixture always uses 48 columns, 8 rows and 64 retained history rows. Panels stack below 1050 CSS pixels. The terminal grid does not resize; narrow windows scroll the terminal frame horizontally. Controls stay above the panels.

History starts paused. Resume schedules the single page in one second; Pause cancels that schedule. Release one page bypasses the pause gate for exactly one page. Controlled live output replaces the last screen row once. Click either usable terminal and type `k`; only that glyph is echoed, once. Reset discards history, live output and recorded input.

## Agreed public test seams

Koen confirmed these before tests on 2026-10-01:
- The isolated public xterm extension for screen restoration and parsed-history prepend.
- The fixture comparison page for actual rendered cells, scrolling and controlled input.

Consumers import the candidate's public `Terminal` export. They never access private xterm fields. The patch adds these declarations to upstream `typings/xterm.d.ts`:

```ts
interface IScreenFirstSnapshot {
  snapshotId: string;
  watermark: number;
  cols: number;
  rows: number;
  historyRows: number;
  screenVt: string;
}
interface IParsedHistoryPage {
  snapshotId: string;
  watermark: number;
  index: number;
  rows: string[];
}
terminal.restoreScreenFirst(snapshot): Promise<void>;
terminal.prependHistoryPage(page): void;
```

These are experiment extensions, not official upstream APIs. `restoreScreenFirst` resolves after portable VT parsing, not painting. The adapter waits for public `onRender`, then two animation frames. It clears and positions the screen in the queued write so previously queued controlled output cannot survive Reset.

The adapter separates baseline presentation from write ownership: it queues the complete controlled-output drain before mirroring new writes, even while the baseline still waits for paint. Reset queues a parser cancellation and full reset behind old baseline writes. Timer and click releases share an operation owner and wait for the current reset's parser fences.

`prependHistoryPage` inserts physical buffer rows inside the source fork. It does not call `write`, execute VT, move the cursor or replace live cells. It moves the live-buffer base, viewport and saved-cursor absolute row together, emits the scroll update and requests a render. Buffer insertion updates markers through xterm's existing insert event. A selected range is rejected rather than promising selection preservation.

### Identity, watermark and bounds

- Snapshot identity is the SHA-256 of the frozen Ghostty binary snapshot in `fixture.snapshot`. `build.mjs` checks it against `fixture.json`. The exporter stamps every page with that identity and watermark.
- Watermark `1` marks the end of the frozen source input. All controlled continuation bytes come after it. Import must match the original snapshot watermark even after newer live output arrives. This is not a real PTY sequence coordinator.
- Pages arrive newest to oldest, starting at index `0`. Each page's physical rows are chronological. Duplicates, stale identities, wrong watermarks and out-of-order pages are rejected before mutation.
- The public extension accepts at most 64 history rows total and per page. Every row must be printable ASCII and no wider than the terminal. At this fixture geometry, text payloads are at most 3072 bytes per page. Screen VT is bounded to 16384 UTF-16 code units; metadata identity is at most 128 code units.
- Geometry must match the receiving terminal. Capacity exhaustion and alternate-buffer imports reject instead of trimming live rows. Reset, Clear, Resize and Dispose invalidate the import session. An import before screen parsing completes rejects.
- No reflow, wrapped lines, Unicode history, styled history, alternate-screen restoration, images, parser-continuation transport, or arbitrary live output is claimed. These belong to later vertical slices. The normal fixed-grid screen and the controlled ASCII continuations are the only authority data supported here.

## Source and tool pins

`pins.json` pins official xterm **6.0.0** at `f447274f430fd22513f6adbf9862d19524471c04`. The GitHub source archive must hash to `82337f91a9df63998d89ba906389d5152a2e8278b558ea72c5dec25ec93a591e`. Each build extracts pristine source, builds the baseline, applies `xterm.patch` with zero fuzz, then builds the candidate. Only the public Terminal, core history insertion, internal passthrough type and public declarations change.

Build tools are isolated and pinned by `package.json` and `pnpm-lock.yaml`: pnpm 10.32.1, TypeScript 5.5.4 and esbuild 0.25.5. PNG checks use pngjs 7.0.0. No addons apply to this fixed-geometry, plain-text DOM-rendered slice, so none are installed or borrowed from shared dependencies. The standalone exporter has its own Cargo workspace, `Cargo.lock` and Rust 1.98.0 toolchain pin. Zig is 0.16.0.

Ghostty stays the Terminal State Authority. Source is `22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018`, with safe Rust bindings `de9fd9b0fa4ab53faebd3d489f4c74fe0ec832ec`, version 0.2.1. The exporter rejects a different or modified source checkout. `XTERM-LICENSE`, `VSCODE-LICENSE`, `GHOSTTY-LICENSE` and `BINDINGS-LICENSE` retain the applicable upstream notices. Downloaded source also retains its own notices and vendored licenses.

## Exporter and precomputation costs

The pinned public APIs provide the minimum data. The exporter parses the small source fixture into Ghostty, encodes the binary snapshot, decodes READY, selects the active 48-by-8 area for portable VT, and formats physical history rows through public grid references and selections. It drives `next()` through FINISH and checks that history did not change the screen.

Important limitation: this small snapshot's active native page already contains all 16 older rows at READY. They are deliberately withheld from xterm and exported as one parsed frontend page. There are **zero later native HISTORY records** in this fixture. This demonstrates frontend screen-first presentation and prepend, not native streaming latency or accelerated snapshot download. Ghostty's default formatter includes history, so the exporter explicitly selects only active cells for `screenVt`.

All source parsing, binary encoding, READY decoding, selection formatting and history export happen before page launch. The browser downloads the complete small frozen JSON even while the history adapter withholds pages. There is no network streaming benchmark, production IPC timing or isolated browser-memory measurement. Measurements in `fixture.json.costsMs` are one native observation, not a performance claim. `parse` includes fixture construction and authority initialization; `historyExport` includes FINISH and a final screen comparison. JSON/base64 conversion, hashing and file writes are outside those phase timings. Initial native compilation took about 2 minutes 14 seconds on this machine, separate from runtime export.

Regeneration requires the existing prepared authority checkout. It does not modify it. From the repository root, prepare the existing official pin with `pnpm ghostty:prepare` if absent, then:

```sh
node scripts/experiments/xterm-screen-first/export-fixture.mjs
# Check reproducibility without replacing the frozen files:
node scripts/experiments/xterm-screen-first/export-fixture.mjs --check
```

`GHOSTTY_SOURCE_DIR` and `GHOSTTY_ZIG_SYSTEM_DIR` can specify prepared paths for the same pin. Unsupported data, incomplete history, missing native APIs or changed screen data cause an explicit no-go/error. The exporter does not fall back to xterm as authority or widen production scope.

## Checks and evidence

With your existing Arc debugging session reachable:

```sh
cd scripts/experiments/xterm-screen-first
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace run build
pnpm --ignore-workspace run check
pnpm --ignore-workspace test
# Replace the checked-in intermediate-frame evidence intentionally:
RECORD_EVIDENCE=1 pnpm --ignore-workspace test
node export-fixture.mjs --check
```

Ordinary test screenshots go to ignored `dist/evidence/`. Browser tests create and close only their own Arc tabs. No other browser runs. `check` covers the adapter and the complete patched xterm browser dependency graph. The standalone native crate also requires `cargo test --release --locked`, `cargo check --locked`, `cargo build --release --locked`, `cargo clippy --all-targets --locked -- -D warnings`, and `cargo fmt -- --check` from `native/`, with the same Ghostty environment paths.

Recorded actual frames:
- [Correct screen while all history is withheld](evidence/01-history-withheld.png)
- [One page released without changed live cells](evidence/02-page-released.png)
- [Older history is scrollable](evidence/03-history-scrollable.png)
- [Controlled live output and a real key with history still paused](evidence/04-live-input-history-paused.png)
- [Stacked panels and reachable controls in a narrow Arc window](evidence/05-narrow-controls.png)

`evidence/frames.json` records the public buffer state and browser version. The candidate's painted cell pixels match the completed baseline before any history release. After prepend they still match. Pixel comparison excludes the rightmost 16 pixels because xterm overlays its new scrollbar there; public cell comparisons cover **every** column and the cursor. This is screenshot evidence and DOM-rendered text, not simulated pixels or input-to-photon timing. `evidence/tdd.json` records the red/green checkpoints. `evidence/validation.json` records commands and scope.

The ten Arc tests include two completion-review regressions. [Paint-boundary evidence](evidence/06-paint-boundary.json) records a controlled key arriving while baseline presentation is held at a browser animation frame. [Reset-boundary evidence](evidence/07-reset-boundary.json) records Reset superseding a timer-triggered replay before its parser tick, then verifies every history row against the frozen fixture after the next release. Only browser clock/frame scheduling is controlled; both real public xterm parsers and the comparison-page seam run unchanged.

### Short manual checklist

1. Launch in the existing Arc session. Verify the fixture warning and both fixed-grid panels.
2. Before releasing history, read `FINAL CORRECT SCREEN`, click the candidate and type `k`. The baseline remains concealed and cannot take input.
3. Reset, inject controlled live output, then release one page. The candidate's current row and cursor stay put; the baseline catches up to the same screen.
4. Scroll to history, read `OLDER HISTORY 01`, then return to the live screen. Reset restores the paused starting state.
5. Resume, immediately Pause, and wait more than a second. The older page must remain withheld. Check that controls stay reachable in a narrow window.

Validation scope is the complete isolated experiment and its pinned browser-source dependency graph. Production frontend/backend suites, Electron/real-PTY end-to-end tests, WebGL/addon checks, reflow, IME and image tests are not run because none of those subsystems change and this slice does not support them. No production adoption decision follows from this result.

The native crate has no separate Rust unit tests. Its behavioral check is the exporter reproducibility command and the frozen fixture's browser tests. Trusted mouse clicks exercised the page controls at 720 CSS pixels; the accompanying screenshot was also inspected visually. Early navigation and server-preconnect teardown failures were fixed, then the browser suite was rerun successfully.

## Follow-up

`KVG-5319`, dependent on KVG-5251, records failure-path cleanup in the existing shared Arc CDP experiment helper. That helper was reused, not changed here.
