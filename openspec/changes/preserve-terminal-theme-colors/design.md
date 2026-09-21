## Context

See [proposal.md](proposal.md) for the problem statement. OpenForge currently sends selected terminal tokens only to xterm. Xterm parses terminal output for display but discards the protocol replies it generates because the Rust Ghostty model is the sole Terminal State Authority. The Ghostty models are created without the selected foreground, background, cursor, or ANSI palette, so their OSC 4 and OSC 10/11/12 replies describe unrelated defaults. Their portable VT snapshots also include that unrelated palette.

Theme definitions may come from plugins and may use any browser-valid CSS colour expression, while the native terminal engine needs concrete RGB values. Terminal Sessions can outlive their desktop views and the session daemon supports live executable replacement, so the colour profile cannot exist only in renderer memory or on a view attachment.

The pinned `libghostty-vt` API already separates embedder defaults from program-set OSC overrides. Updating its default foreground, background, cursor, or palette preserves the corresponding effective override, which matches the required live-theme behavior.

## Goals / Non-Goals

**Goals:**

- Give xterm and the Terminal State Authority one normalized terminal colour profile derived from the selected theme.
- Make that profile available before a child process can query terminal colours.
- Update live model defaults in actor order while preserving program overrides and PTY identity.
- Keep the profile available for desktop-free starts, recovery, reconnect, and live daemon replacement.
- Preserve one protocol-response owner.

**Non-Goals:**

- Moving terminal state authority or protocol replies back to xterm.
- Adding terminal-specific theme preferences independent of the application theme.
- Changing terminal font, selection, link, image, or accessibility behavior.
- Replacing xterm's minimum-contrast rendering policy.
- Adding an external CSS colour parsing dependency.

## Decisions

### Use a normalized semantic profile at the renderer boundary

Add a versioned `TerminalColorProfile` containing opaque sRGB foreground, background, cursor, and the 16 theme-defined ANSI colours. The theme presentation adapter will resolve CSS functions and variables only after the selected theme's stylesheet is active, normalize the values to RGB bytes, and use the same normalized values for xterm and native publication. Renderer-only colours such as selection foreground/background and cursor accent remain in the existing view theme snapshot.

The resolver will use browser CSS resolution and a one-pixel canvas readback to convert supported CSS colour syntax without introducing another parser. Alpha colours will be composited to opaque sRGB using the resolved terminal background and application surface, then the normalized opaque values will be given to both owners. A profile is accepted atomically only when every authority-owned colour resolves; an unresolvable contributed profile follows the existing unavailable-theme fallback instead of mixing two palettes.

Alternatives considered:

- Sending CSS strings to Rust would duplicate an evolving browser colour parser and would not reliably resolve plugin variables.
- Sending only the theme identifier would not work for contributed themes or future token changes.
- Resolving colours independently in xterm and Rust would retain the mismatch this change is intended to remove.

### Define the complete 256-colour result deterministically

The first 16 palette entries come from the normalized theme profile. Entries 16 through 231 use the xterm 6-by-6-by-6 colour cube, and entries 232 through 255 use the xterm grayscale ramp. The native boundary constructs the complete palette from this rule and installs it as the model default. This matches the extended palette xterm displays before program overrides and prevents portable snapshots from introducing Ghostty's built-in extended palette.

Alternatives considered:

- Reusing Ghostty's built-in or generated palette would leave indices 16 through 255 different from xterm.
- Sending all 256 colours over every boundary would enlarge the contract without adding theme-controlled information.

### Publish the profile as installation-scoped terminal state

Add a typed desktop command that publishes a validated profile after each serialized theme commit. The Rust sidecar stores the last accepted versioned profile in application configuration and owns the deterministic OpenForge Light fallback. It applies the profile to the legacy in-process terminal manager when present and forwards a retry-safe installation-scoped profile mutation to the session daemon.

The sidecar loads the stored profile before terminal reconciliation. A daemon connection or replacement must reconcile the current profile before accepting a later spawn. This makes the last accepted profile available to background and companion workflows that start terminals without a desktop view. Missing, corrupt, or older persisted data resolves to the built-in OpenForge Light profile.

Publication belongs beside theme lifecycle, not Terminal View attachment lifecycle. A theme change therefore never creates or releases a view, session, or PTY. Publication completion is part of a completed theme selection; transport interruption may delay daemon delivery, but the durable sidecar value is accepted first and is replayed before subsequent terminal creation.

Alternatives considered:

- Adding the profile only to spawn requests would not update existing sessions and would duplicate data across every provider path.
- Keeping it only in renderer memory would fail for desktop-free starts and app reconnects.
- Reading theme definitions in Rust would couple the backend to frontend plugin loading and CSS evaluation.

### Serialize updates through each terminal-model actor

Extend the terminal-model actor with an `UpdateColorProfile` command. Model creation installs the current profile before the PTY child is spawned. A live update changes Ghostty's default foreground, background, cursor, and default palette through the same bounded actor queue that processes PTY output, snapshots, and resize commands. This gives each model a single observable order for profile updates and colour queries.

The daemon keeps the installation profile in its backend table, applies it to current live processes, and includes it in daemon checkpoints. Ghostty model checkpoints continue to preserve effective OSC overrides. Updating the embedder defaults does not clear those overrides; portable VT formatting emits the effective state after the actor barrier.

Profile application is all-or-nothing at each model. If a model cannot accept an update, that PTY follows the existing authority-failure policy rather than allowing renderer and authority state to diverge silently.

Alternatives considered:

- Mutating Ghostty directly from the daemon control thread would race PTY output and snapshot capture.
- Recreating models or PTYs on theme changes would lose parser state, session identity, or the running process.

### Version the native contracts and keep one response owner

Add camelCase profile payloads to typed desktop IPC and an installation-scoped session-protocol command with retry identity. Bump the local daemon protocol version and extend checkpoint validation for the profile record. The browser response filter remains unchanged: xterm continues to parse output for rendering but its CSI, DCS, and OSC query replies are never forwarded to the PTY.

Contract tests will cover RGB bounds, exact field names, unknown-field rejection, protocol-version negotiation, idempotent retry, and stale-controller behavior. Terminal conformance tests will send batched OSC 10/11/12 and OSC 4 queries through a real PTY-shaped path and assert one ordered reply per query.

Alternatives considered:

- Re-enabling xterm replies would create two protocol authorities and make snapshot state disagree with the replies a program received.
- Treating theme publication as ordinary PTY input would incorrectly scope installation state to one session and would allow programs to observe duplicate or reordered mutations.

## Risks / Trade-offs

- [Theme selection now crosses a native boundary] → Keep profile publication small, serialized, retry-safe, and durable in the sidecar before acknowledging it.
- [Contributed CSS colours may resolve differently across Chromium versions] → Normalize once in the active renderer and publish RGB bytes; cover modern CSS syntax, variables, alpha composition, and resolution failures with browser-level tests.
- [A daemon update can overlap heavy terminal output] → Use the existing bounded actor queue and authority-failure behavior instead of a second mutation path.
- [Protocol and checkpoint changes can disrupt live replacement] → Version both contracts, accept checkpoints with no profile by deriving the deterministic fallback, and require profile reconciliation before post-upgrade spawns.
- [Portable VT emits a full palette] → Construct the extended palette with xterm's fixed algorithm so recovery cannot replace visually correct extended colours.
- [Persisted contributed profiles can outlive their plugin] → Theme initialization republishes the resolved selected or fallback theme; until then, the stored profile is safer for headless continuity than an unrelated engine default.

## Migration Plan

1. Introduce the shared profile contract, normalizer, fallback, and validation without changing response ownership.
2. Add model initialization and actor updates, then cover queries, program overrides, portable snapshots, and checkpoint restoration.
3. Add the versioned daemon mutation and checkpoint field. During upgrade, a missing field loads the OpenForge Light fallback and the sidecar republishes the current stored profile before new spawns.
4. Wire typed IPC and theme lifecycle publication, then enable the path for built-in and contributed themes.
5. Update terminal authority documentation and run the full affected frontend, terminal-runtime, IPC-contract, Rust sidecar, session-protocol, session-host, and session-daemon validation.

Rollback can disable renderer publication while leaving the native fallback in place. A binary rollback that cannot speak the new daemon protocol requires replacing or restarting the daemon through the existing managed-replacement path; no database migration is required because the stored profile is a versioned optional configuration value.
