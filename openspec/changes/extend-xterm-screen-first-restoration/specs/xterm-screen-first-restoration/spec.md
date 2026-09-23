## Purpose

Defines an experimental restoration capability that presents a terminal's current screen before loading older history, while preserving live output, reading position and terminal compatibility. It establishes the evidence needed to consider production adoption without enabling the experiment in normal sessions.

## ADDED Requirements

### Requirement: Experiment isolation
The experiment SHALL be opt-in and SHALL leave production terminal behavior, dependency resolution, session ownership and persisted data unchanged. Its dependency changes SHALL be reproducible from recorded source identities and exposed through a documented experimental interface rather than private-field access by consumers.

#### Scenario: Ordinary application build
- **WHEN** the application is built or run without explicitly launching the experiment
- **THEN** it uses the existing renderer and restoration path
- **AND** the experiment does not alter the shared dependency installation or production data

#### Scenario: Reproducing the experiment
- **WHEN** a developer follows the recorded build instructions
- **THEN** the source revisions, patches, tools and fixture identities needed to reproduce the tested build are available
- **AND** generated experiment files remain separate from production dependencies

### Requirement: Current screen readiness independent of history delivery
For supported restoration inputs, the experiment SHALL present the correct current screen and accept input before older history finishes loading. First-screen readiness SHALL certify completed presentation for the current restoration identity, not merely completed decoding or queued rendering. Older history SHALL NOT be visibly replayed or required to construct the first usable screen.

#### Scenario: All history pages are withheld
- **WHEN** current screen state is available but delivery of every older history page is delayed
- **THEN** the correct current screen becomes visible and usable without waiting for a history page
- **AND** history remains explicitly incomplete

#### Scenario: Long history arrives after readiness
- **WHEN** a ready terminal receives older history in multiple pages
- **THEN** no intermediate historical screen is shown as playback
- **AND** the imported history becomes available through ordinary scrolling

### Requirement: Atomic parsed history import
The restoration interface SHALL import older history as data without executing that history as terminal commands. Each accepted page SHALL be validated and applied atomically, preserving current screen cells, cursor, modes, parser continuation and protocol-response ownership. Invalid or excessive page data SHALL leave the previous valid state unchanged and return an explicit error.

#### Scenario: History arrives during a split live escape sequence
- **WHEN** history is imported between parts of a live escape sequence or UTF-8 character
- **THEN** subsequent live bytes complete the same sequence or character correctly
- **AND** the history import emits no user input or terminal-generated reply to a PTY

#### Scenario: Malformed page
- **WHEN** a page contains invalid row geometry, unsupported schema, invalid references or data exceeding the declared limits
- **THEN** the complete page is rejected before any of its rows become visible
- **AND** the live terminal remains usable

### Requirement: Stable reading position and retained history
History arrival SHALL preserve the user's logical reading position and retained selection rather than preserving numeric indices alone. Restored rows SHALL retain their text, cell widths, styles, soft-wrap relationships and hyperlinks. Retention SHALL prefer newer history and live content over older imported rows and SHALL distinguish retention omissions from successful imports.

#### Scenario: Following live output
- **WHEN** a user is at the live bottom and older rows are imported
- **THEN** the terminal continues to show the same live screen and follows later live output

#### Scenario: Reading and selecting older output
- **WHEN** a user scrolls above the live bottom and selects retained text before an older page arrives
- **THEN** page arrival preserves the same logical content at the reading anchor
- **AND** copying the retained selection yields the same text
- **AND** hyperlink targets remain associated with the same content

#### Scenario: Wrapped content spans a page boundary
- **WHEN** an imported page joins a soft-wrapped logical line in an existing page or the current screen
- **THEN** the resulting display, copied text and subsequent reflow match the reference logical line without duplication or omission

#### Scenario: Scrollback capacity is reached
- **WHEN** importing older rows would exceed the retention limit
- **THEN** newer retained rows and the live screen are not evicted to accommodate those older rows
- **AND** omitted older rows are reported as excluded by retention

### Requirement: Restoration identity and live output ordering
Screen state and history pages SHALL belong to one immutable snapshot identity and watermark. The experiment SHALL present only contiguous newer live output for the same PTY instance and SHALL reject stale, mismatched or out-of-order history. Duplicate delivery SHALL NOT duplicate rows or output.

#### Scenario: Live output arrives before history completion
- **WHEN** newer contiguous output arrives after screen readiness while history is still loading
- **THEN** it appears without waiting for the remaining history
- **AND** later imported pages do not overwrite that output

#### Scenario: Duplicate, missing or reordered delivery
- **WHEN** a history page is duplicated, its predecessor range is missing, or a live output sequence contains a gap
- **THEN** the experiment reports the applicable duplicate or recovery condition without silently accepting an inconsistent order
- **AND** it does not claim complete history until the accepted retained range is accounted for

#### Scenario: Another PTY or snapshot supplies a page
- **WHEN** a page targets a replaced PTY instance, superseded snapshot or different session
- **THEN** it cannot mutate the current screen, history, selection or reading position

### Requirement: Geometry and attachment safety
Pending restoration work SHALL be scoped to the current geometry and attachment generation. Resize SHALL NOT silently discard remaining pages while reporting full history. Cancellation, hiding or detachment SHALL NOT change PTY liveness, and obsolete completions SHALL NOT reveal or focus a replacement view.

#### Scenario: Resize during loading
- **WHEN** the terminal resizes while old-geometry pages are outstanding
- **THEN** those pages are rejected for the new geometry and restoration obtains a fresh generation
- **AND** the completed retained history matches the resized reference instead of reporting skipped pages as loaded

#### Scenario: Cancel, detach and reopen
- **WHEN** restoration is cancelled or the view detaches before history completion and late pages arrive
- **THEN** those pages do not alter the last valid state or a newer attachment
- **AND** reopening can restore from a fresh identity without terminating the session

### Requirement: Explicit compatibility outcomes
The experiment SHALL test alternate screens, supported inline images, selection, hyperlinks, Unicode, input, parser continuation and renderer fallback. It SHALL either preserve the required behavior for an input or explicitly report that input as unsupported before presenting it as a correct restoration. An unsupported or legacy-fallback result SHALL NOT count as successful screen-first restoration or justify production adoption.

#### Scenario: Alternate screen remains active
- **WHEN** primary-buffer history is imported while an alternate screen is active
- **THEN** the alternate screen and cursor remain intact
- **AND** returning to the primary buffer reveals the expected imported history and saved state

#### Scenario: Restoring image-bearing output
- **WHEN** current screen state or history contains supported inline images
- **THEN** successful restoration preserves image pixels, placement and resource lifetime across import and trimming
- **OR** the experiment reports an explicit unsupported result and excludes that run from successful candidate measurements

#### Scenario: Renderer fallback
- **WHEN** the accelerated renderer is unavailable or loses its context during restoration
- **THEN** a successful candidate preserves the same screen and history behavior using the fallback renderer
- **AND** any inability to do so is recorded as a failed compatibility gate

### Requirement: Reproducible decision evidence
The experiment SHALL report correctness and performance against the current concealed-replay path using matched fixture bytes, geometry, retention and rendering conditions. It SHALL distinguish first correct usable screen from history completion, include export and transport assumptions, and retain all measured trials. A go recommendation SHALL require complete compatibility evidence and improved first-screen latency without unexplained responsiveness or memory regressions; otherwise the report SHALL state no-go and the remaining blockers.

#### Scenario: Comparing long-history restoration
- **WHEN** baseline and candidate measurements are produced
- **THEN** the report includes stage timings, first correct usable frame, full retained-history completion, page work, input responsiveness, memory and fixture identities
- **AND** it includes multiple trials and intermediate-frame evidence rather than only a final screenshot
- **AND** native decode timing or precomputed export work is not misrepresented as end-to-end frontend latency

#### Scenario: Partial prototype result
- **WHEN** only text-only cases pass or a required feature cannot be implemented within the experiment scope
- **THEN** the report distinguishes proven behavior, unsupported cases and unmeasured claims
- **AND** it does not recommend production adoption or enable the experimental path
