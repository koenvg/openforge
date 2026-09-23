## Context

See proposal.md for motivation and experiment scope. This is KVG-5237's xterm-extension route, not a production cutover or a modification of KVG-5198's active native experiments.

Observed in this checkout:

- `docs/terminal-state-and-response-paths.md` defines Ghostty as the live Terminal State Authority. xterm renders accepted, sequenced PTY bytes and does not own protocol replies.
- `terminalAuthorityCoordinator.ts` replaces a view from one snapshot watermark before releasing newer output. Ended sessions instead restore historical replay with no live PTY.
- `xtermTerminalView.ts` conceals compatibility replay, portable VT and parser continuation until a completed render. It still parses historical bytes. The user's continuing visible playback has not been reproduced in this investigation; this experiment does not claim a confirmed diagnosis of that occurrence.
- Installed xterm 6.0.0 exposes writes and read-only buffer inspection, but no public history import. Its internal `CircularList.splice()` emits insertion/deletion/trim events. `Buffer` separately tracks the live base, displayed offset, cursor, saved cursor, markers and wrapped lines. Inserting rows alone is not a correct restoration implementation.
- `scripts/experiments/terminal-restoration/README.md` records a successful native Ghostty READY/FINISH probe, but no correct frontend incremental-history implementation. Its resize probe skipped remaining history pages. Native timings are not browser readiness evidence.

Design is required because this experiment changes a dependency's buffer behavior, introduces paged restoration data, and must prove ordering and performance across asynchronous operations.

## Goals / Non-Goals

**Goals:**
- Test whether an explicit xterm extension can retain the existing browser terminal interaction model while decoupling first presentation from history reconstruction.
- Put buffer mutation inside the patched dependency, behind a public experimental interface. Test callers must not depend on xterm private object layouts.
- Produce a reproducible result, including a useful no-go result if required compatibility cannot be preserved.

**Non-Goals:**
- Production transport, persistence, package catalog or lockfile changes; a new renderer setting; replacing Ghostty authority; changes in other worktrees.
- A custom history viewer, private-field access from application code, two terminals swapped after full replay, or hiding full replay and calling it screen-first.
- Optimizing agent startup that independently prints its conversation as new PTY output. That is distinct from snapshot restoration.
- A complete general-purpose snapshot standard for every xterm consumer.

## Decisions

### 1. Keep the patched dependency experiment-local

Place authored files under `scripts/experiments/xterm-screen-first/`. Pin the official source corresponding to xterm 6.0.0 to an exact revision and checksum in the experiment manifest. Record build tool and addon versions, and retain its MIT license. Keep the patch as a reviewable source diff with an isolated build recipe. Generated source checkouts, dependencies, bundles and raw recordings go under ignored `artifacts/xterm-screen-first/`. Any experiment package or standalone native helper has its own configuration and lockfile, outside the root workspace's dependency resolution.

The browser harness resolves the patched build only within this experiment. A normal OpenForge build must continue using stock xterm. Do not patch shared `node_modules`, register a root `pnpm.patchedDependencies` entry, or edit the existing experiment to make the prototype run.

Alternative: a wrapper around xterm private fields. Rejected because it leaves buffer invariants distributed between app code and the dependency and is harder to maintain or propose upstream.

### 2. Separate bounded screen restoration from parsed history import

Use this flow:

```text
Frozen authority snapshot at watermark W
    |
    +--> Screen state + continuation + required visible assets
    |        --> restore --> present --> accept output newer than W
    |
    +--> Parsed older rows, nearest history first
             --> validate page --> prepend without executing VT
```

Proposed experiment adapter operations are `restoreScreen`, `prependHistory` and `cancelRestore`. Names can change before implementation once the public test seams are confirmed. `restoreScreen` returns a generation-scoped handle and resolves only after the correct screen is presented and input can be accepted. History completion is a separate observable result. `prependHistory` returns an applied, duplicate, stale, retained-limit or unsupported result, rather than making completion ambiguous.

`restoreScreen` may use bounded screen-only VT for current primary/alternate screen state, modes, effective colors and parser continuation. It must not parse the complete history to obtain that first screen. The essential new xterm operation imports attributed history rows directly, without writing those rows through the live parser. If screen state cannot be exported without old history, record a blocker rather than disguising that work as setup time.

Keep OpenForge-specific identity and watermark checks in the adapter. Keep row insertion, cursor/base offsets, selection, markers and renderer invalidation inside the xterm patch. This makes the dependency change useful outside OpenForge without putting PTY ownership into xterm.

Alternative: add only synchronized output or concealment around historical writes. Rejected because it still delays the current screen behind replay.

### 3. Derive both screen and history from one immutable authority snapshot

Add an experiment-local exporter using the already pinned Ghostty source and Rust bindings, without changing the production snapshot contract. Export a versioned manifest containing Shell Session Key, PTY instance or historical-only identity, snapshot token, watermark, geometry revision, screen state, continuation, history range and resource limits.

Export history as data, including grapheme text, display width, style/color attributes, soft-wrap metadata and hyperlink references. Assign snapshot-local row identities and opaque page cursors. These identities need not be Ghostty's internal pointers or stable across different snapshots. Pages are contiguous and ordered from the rows nearest the screen toward older rows. They include their expected successor cursor so missing, duplicate or out-of-order pages cannot silently create incorrect history.

The native READY/FINISH experiment is a starting point, not proof that these row exports or image assets are already available. Validate the pinned APIs early. A missing required export produces a documented no-go or a request for separately approved backend scope; it does not authorize a production dependency upgrade.

For ended-session fixtures, any raw-history conversion happens in the fixture/export stage and its cost is recorded separately. Do not claim fast cold restoration from raw logs on the strength of a precomputed live snapshot.

### 4. Make each history import an atomic buffer transaction

Validate the complete page before mutation: schema, limits, generation, snapshot token, expected cursor, geometry, cell widths, row shape, links and assets. Reject invalid input without partial insertion. Treat strings as cell data, not terminal commands or HTML.

Drain previously queued xterm writes at a defined barrier, apply one bounded import synchronously, update dependent state, then allow later writes. A history transaction must not change parser continuation, terminal modes, the active screen's cell contents or cursor, or generate PTY input/replies. Page loading must not hold newer live output behind the entire history transfer.

Preserve these distinctions:

- At the live bottom, keep following the same live screen as history is prepended.
- While reading history, preserve the same logical row and intra-row position, not the same numeric buffer index.
- Shift retained selection endpoints, markers and image placements consistently. Preserve copied text and hyperlinks across imported/existing rows.
- Honor the existing scrollback limit. Never evict newer live content to make room for older imported rows. Bound an incoming page before circular insertion; do not rely on overflowing `splice()` to preserve the right rows. Report rows omitted by retention separately from rows successfully imported.
- If normal live trimming removes a user's anchor or selection, apply the documented normal trim behavior rather than attributing it to page arrival.

Use bounded page sizes and yield between imports. Trace per-page work; an entire retained history inserted in one blocking operation does not establish responsiveness.

### 5. Fence page identity, geometry and lifecycle explicitly

The adapter binds a restoration handle to Shell Session Key, PTY instance, snapshot token, attachment generation and geometry revision. Accept only contiguous live output above the snapshot watermark; duplicates are discarded and gaps require fresh authority, following the production contract.

On resize, invalidate remaining old-geometry pages and obtain a fresh screen/history generation at the new geometry in the harness. Do not reinterpret old wrapped rows at a new width or report discarded pages as completed history. Verify ordinary xterm reflow for rows already imported, and verify restored selection/viewport behavior against an independently constructed expected screen. A user-driven resize may legitimately change wrapping; history arrival alone must not.

Detach, disposal, replacement and cancellation invalidate late page and reveal callbacks. Cancellation preserves the last valid visible state but leaves history explicitly incomplete. Reattachment or a new PTY requires a fresh handle. Hiding or cancelling presentation never terminates a PTY.

### 6. Treat images and alternate screens as adoption gates

History belongs to the primary buffer even when an alternate screen is active. Importing primary history must not exit or paint over the alternate screen. Returning to the primary screen must reveal the expected history and saved state.

The current image addon owns state not represented by plain cells. Identify a supported experiment-local image restoration contract covering asset bytes, stable placements, retention and disposal. Include any required addon patch in the experiment's pinned dependency set. Never restore images by executing the whole historical output stream after the first screen is visible.

If images or another required feature cannot be represented safely, return an explicit unsupported outcome before exposing a misleading restored screen. The harness can run the existing concealed-replay path as a separately labeled fallback. A fallback is not a successful screen-first sample, and incomplete compatibility prevents a production-adoption recommendation. A text-only milestone is useful evidence, not completion of the compatibility claim.

### 7. Test at the extension and adapter interfaces

Confirm these proposed seams with the user before adding tests during implementation:

1. The patched xterm public history-import operation, observed through normal buffer reads, selection/copy and rendered presentation.
2. The experiment adapter's restoration lifecycle, observed through readiness/completion results, displayed state and a controlled authority transport.

Use vertical TDD slices. The first test holds every history page back, restores a known current screen, and proves that screen is usable before a page is delivered. The next slice imports one older page while live output continues and proves the current screen and read anchor remain correct. Expand only after those pass.

Use real patched xterm for buffer and parser behavior. Do not prove correctness by mocking private services or by comparing an importer against its own output. Expected cells and copied strings come from small hand-authored fixtures and independent authoritative reference exports. Actual browser rendering covers intermediate frames, scrolling, image pixels, selection, input and WebGL fallback.

### 8. Measure the whole restoration path and report a decision

Reuse the earlier long-history fixture bytes and checksum, but generate new baseline and candidate results. Match geometry, fonts, history retention, image support and machine/browser conditions. Use synthetic fixtures, not private task output. Include text, wrapped Unicode and image-bearing workloads at several history sizes with the same current screen.

Record at least five comparable trials per supported renderer path, reporting all trials and medians. Separate export/encoding, transfer, decode, screen parse/import, first correct usable frame, complete history, page latency, input-to-presented-output latency, animation-frame stalls and memory. Report bytes consumed before readiness. Time precomputed export separately and do not present native READY timing as frontend latency. Start browser responsiveness sampling before transfer/decoding, not after expensive synchronous work.

Deterministically hold history delivery to prove first-screen readiness is independent of history arrival. Compare final retained history and intermediate visible frames, not only the final screenshot. Record local fixture-transport limitations and any unavailable memory metric.

Recommend a production follow-up only if all required compatibility cases pass, the candidate improves median first-correct-screen latency on matched long-history fixtures, and input responsiveness and memory show no unexplained regression. Otherwise deliver a bounded no-go with the failing cases and measured costs. In either case, list the patch maintenance burden and whether the public interface is suitable for an upstream proposal. Do not publish a fork or open upstream issues without separate approval.

## Risks / Trade-offs

- Cross-engine row semantics differ. Mitigation: explicit width/wrap/style data and independent reference fixtures, including a soft-wrapped logical line spanning a page boundary and the screen boundary.
- Circular insertion can corrupt newer rows at capacity. Mitigation: validate and pre-limit each atomic import; test full buffers and continued live trimming.
- Image, selection and marker state can outlive their rows. Mitigation: coordinate ownership and disposal inside dependency patches; fail compatibility gates rather than leak or silently drop state.
- Frequent resize can repeatedly invalidate loading. Mitigation: generation cancellation and bounded retries in the harness; report restart cost and incomplete history truthfully.
- A fork becomes permanent maintenance work. Mitigation: pin and isolate it, minimize the public interface and diff, and deliver an upstreamability assessment before production adoption.
- Existing evidence does not reproduce the user's exact scrolling incident. Mitigation: label this as an architectural experiment, not a verified fix for all sources of historical-looking live output.

## Migration Plan

No production migration or rollout occurs. Implementation adds an opt-in experiment directory and ignored generated artifacts only. Removing that directory and its generated output restores the pre-experiment repository behavior. Production integration, new wire payloads and any shared dependency patch require a later approved change after reviewing the report.
