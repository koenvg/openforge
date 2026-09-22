# Terminal Session Coordination Specification

## Purpose

Defines the Terminal Runtime behavior that keeps PTY identity, authoritative terminal state, temporary view attachments, recovery, and geometry control consistent across asynchronous events.

## Requirements

### Requirement: Opaque Terminal Session access
The Terminal Runtime SHALL return an opaque Terminal Session handle from acquisition and SHALL NOT expose mutable coordination state or direct mutable Terminal View access through that handle.

#### Scenario: Session acquisition
- **WHEN** a caller acquires a Terminal Session by Shell Session Key
- **THEN** the runtime returns a handle that can be passed to runtime operations without exposing PTY, watermark, attachment, visibility, or recovery fields for caller mutation

#### Scenario: Runtime diagnostics
- **WHEN** a test, conformance check, or performance probe observes a Terminal Session
- **THEN** the runtime provides a read-only diagnostic observation without granting mutation access to session coordination state

### Requirement: Ghostty-authoritative restoration ordering
The Terminal Runtime SHALL restore a Terminal View from the replay or Terminal Snapshot supplied by Ghostty Terminal State Authority before presenting later live output for the same PTY instance.

#### Scenario: Live output arrives during snapshot replacement
- **WHEN** live output for the current PTY instance arrives while an authoritative snapshot replacement is pending
- **THEN** the runtime withholds that output until snapshot replacement completes and then presents only output newer than the snapshot watermark

#### Scenario: Live output has a sequence gap
- **WHEN** live output for the current PTY instance does not continue from the accepted authority watermark
- **THEN** the runtime requests fresh authority state before presenting the non-contiguous output

#### Scenario: Replay has no current PTY
- **WHEN** authority returns historical terminal data without a current PTY instance
- **THEN** the runtime may present the historical data but reports the Terminal Session as inactive and does not accept user input as live PTY input

### Requirement: Stale PTY work rejection
The Terminal Runtime SHALL reject output, exit, disable, replay completion, and spawn completion work that targets a PTY instance other than the Terminal Session's current instance.

#### Scenario: Output from a replaced PTY
- **WHEN** model output names a PTY instance that is not current
- **THEN** the runtime does not present the output, advance the current watermark, or report output for the current lifecycle

#### Scenario: Replay resolves after PTY replacement
- **WHEN** an authority read begins for one PTY instance and resolves after another instance becomes current
- **THEN** the runtime does not apply the stale replay to session state or the Terminal View

#### Scenario: Exit from a replaced PTY
- **WHEN** an exit event names a PTY instance that is not current
- **THEN** the runtime leaves the current PTY active and leaves explicit shell-exit state unchanged

### Requirement: Spawn selection is coordinated
The Terminal Runtime SHALL permit at most one pending PTY spawn selection for a Terminal Session and SHALL delay ambiguous live output until the spawned PTY instance becomes authoritative.

#### Scenario: Spawn completes with matching pending output
- **WHEN** output arrives while a spawn is pending and authority selects the same PTY instance
- **THEN** the runtime restores authoritative state and then presents eligible pending output

#### Scenario: Spawn completes with another instance
- **WHEN** output arrives while a spawn is pending and authority selects a different PTY instance
- **THEN** the runtime discards the pending output from the unselected instance

### Requirement: Terminal View Attachment lifecycle independence
The Terminal Runtime SHALL keep Terminal View Attachment lifecycle independent from Terminal Session and PTY lifecycle.

#### Scenario: Attachment detaches
- **WHEN** the current Terminal View Attachment detaches
- **THEN** the runtime removes presentation resources and pauses view output without ending or deactivating the Terminal Session

#### Scenario: Presentation resets
- **WHEN** a caller resets terminal presentation for restart or recovery
- **THEN** the runtime clears the view without using the reset marker as PTY liveness

### Requirement: Attachment generation safety
The Terminal Runtime SHALL assign generations to Terminal View Attachments and SHALL reject attachment work from a superseded generation.

#### Scenario: Superseded attachment detaches
- **WHEN** an older attachment calls detach after the Terminal Session has moved to a newer attachment
- **THEN** the runtime leaves the newer attachment mounted and current

#### Scenario: Recovery completes for a superseded attachment
- **WHEN** recovery or fitting started for one attachment generation and completes after replacement
- **THEN** the runtime does not render, focus, resize, or otherwise alter the replacement attachment using the stale completion

### Requirement: Visibility recovery
The Terminal Runtime SHALL suspend live Terminal View rendering while an attachment is hidden and SHALL restore current Ghostty authority before resuming live rendering when it becomes visible.

#### Scenario: Hidden output burst
- **WHEN** a mounted attachment is hidden while terminal output continues
- **THEN** the runtime does not parse or queue an unbounded hidden-view output stream and marks the view for authority recovery

#### Scenario: Attachment becomes visible
- **WHEN** a hidden attachment becomes visible
- **THEN** the runtime enables live output, restores current authority into the same visible attachment generation, and only then resumes later live output

#### Scenario: Visibility changes during recovery
- **WHEN** visibility changes while an authority read or snapshot replacement is pending
- **THEN** the runtime rejects presentation work for the stale visibility generation and performs another recovery if the current visible attachment remains dirty

#### Scenario: Visible recovery fails transiently
- **WHEN** authority recovery fails while the attachment remains current and visible
- **THEN** the runtime keeps the view marked dirty and retries without leaving live output permanently disabled

### Requirement: Terminal Geometry Lease enforcement
The Terminal Runtime SHALL allow only the current visible Terminal View Attachment to set PTY rows and columns.

#### Scenario: Current attachment refits
- **WHEN** the current visible attachment obtains valid terminal dimensions
- **THEN** the runtime resizes the PTY using those dimensions

#### Scenario: Stale or hidden attachment refits
- **WHEN** a superseded, hidden, or detached attachment attempts to refit or an old resize callback fires
- **THEN** the runtime does not resize the PTY

### Requirement: Bounded transitional output
The Terminal Runtime SHALL bound output held during bootstrapping or PTY selection and SHALL use authority recovery instead of retaining unbounded presentation output.

#### Scenario: Transitional output exceeds the bound
- **WHEN** output received during bootstrapping or PTY selection exceeds the configured pending-output bound
- **THEN** the runtime retains only bounded transitional state and converges through an authoritative replay

#### Scenario: Output arrives while detached or hidden
- **WHEN** output arrives while no visible attachment can present it
- **THEN** the runtime marks the view for recovery rather than accumulating that output for later renderer replay

### Requirement: Authoritative terminal colour profile
The Terminal State Authority SHALL initialize every live PTY with the active terminal foreground, background, cursor, and 256-colour palette before the child process can issue terminal queries. The authority SHALL use the effective terminal colours for protocol replies, and the Terminal View SHALL continue to discard renderer-generated replies so each query has one response owner.

#### Scenario: Program queries startup colours
- **WHEN** a terminal program issues foreground, background, cursor, or indexed-palette queries at startup, including multiple queries in one output batch
- **THEN** it receives exactly one reply per query from the Terminal State Authority
- **AND** each reply reports the corresponding effective colour from the active terminal profile

#### Scenario: No saved profile is available
- **WHEN** a terminal starts before any selected or previously saved terminal profile is available
- **THEN** the authority initializes it with the deterministic OpenForge Light terminal profile
- **AND** colour queries do not fall back to an unrelated terminal-engine palette

### Requirement: Live terminal colour synchronization
The Terminal State Authority SHALL apply a newly selected terminal profile to the defaults of every live Terminal Session without changing its Shell Session Key, PTY instance, process, or attachment. Defaults changed by the host SHALL remain distinct from effective colours overridden by terminal programs.

#### Scenario: Theme changes during a live session
- **WHEN** the user changes the selected theme while a Terminal Session is live
- **THEN** the session keeps the same PTY and running process
- **AND** its unoverridden foreground, background, cursor, and palette entries adopt the newly selected terminal profile

#### Scenario: Program has overridden terminal colours
- **WHEN** a terminal program has overridden one or more colours through terminal control sequences and the selected theme changes
- **THEN** those program overrides remain the effective colours
- **AND** resetting an override reveals the corresponding default from the newly selected profile

#### Scenario: Profile update overlaps terminal output
- **WHEN** a terminal profile update and terminal output containing colour queries are processed concurrently
- **THEN** each Terminal Session observes them in one authoritative order
- **AND** every reply reflects the effective profile at the point where its query is processed

### Requirement: Durable terminal colour restoration
The Terminal State Authority SHALL preserve the accepted terminal profile and effective program overrides through recovery and live daemon replacement. Portable restoration SHALL reproduce the authority's effective colours without substituting a terminal-engine default palette, and new desktop-free sessions SHALL use the last accepted profile when it is available.

#### Scenario: Terminal View recovers
- **WHEN** a Terminal View is rebuilt from an authoritative snapshot after hiding, detachment, a sequence gap, or reconnect
- **THEN** the restored foreground, background, cursor, and palette match the authority's effective state at the snapshot watermark
- **AND** restoration does not replace selected-theme defaults with unrelated built-in colours

#### Scenario: Daemon is replaced with live sessions
- **WHEN** the session daemon is replaced while Terminal Sessions remain live
- **THEN** the accepted default profile and any effective program overrides survive with those sessions
- **AND** subsequent colour queries and snapshots report the same effective colours

#### Scenario: Session starts without a desktop view
- **WHEN** a background or companion workflow starts a Terminal Session without a desktop Terminal View attached
- **THEN** the session uses the last accepted terminal profile, or the deterministic fallback if none has been accepted
- **AND** attaching a view later does not change the session's colour state merely because it became visible

### Requirement: Sustained terminal mutation availability
The terminal system SHALL keep retry metadata bounded without imposing a lifetime operation-count limit on normally acknowledged input, resize, spawn, or termination requests. Completed terminal I/O SHALL NOT permanently consume capacity needed by other terminals or new sessions.

#### Scenario: Sustained input and resize
- **WHEN** live terminals process more than ten times the configured receipt-window limit in acknowledged input and resize requests
- **THEN** subsequent input and resize requests continue to succeed and retained retry metadata remains within configured bounds

#### Scenario: Starting a terminal after sustained activity
- **WHEN** existing terminals have exceeded the receipt-window limit in acknowledged operations and live-session resources remain available
- **THEN** a new terminal starts without requiring an app restart or terminating another session

#### Scenario: Repeated terminal lifecycle operations
- **WHEN** acknowledged spawn and termination requests exceed the receipt-window limit while live and retained-session counts remain within their bounds
- **THEN** later lifecycle requests continue to succeed without accumulating lifetime receipt history

### Requirement: Safe retirement of terminal operation receipts
The terminal system SHALL retire retry records only when requests outside the retained window can be rejected without re-execution. It SHALL preserve at-most-once mutation execution, ordered PTY input, and explicit unknown outcomes. It SHALL NOT replay uncertain input under a fresh operation identity automatically.

#### Scenario: Response lost before acknowledgement
- **WHEN** an operation executes but its response is lost and the client retries the same retained operation with the same payload
- **THEN** the system returns its recorded result or explicit unknown outcome without executing it again

#### Scenario: Conflicting retained retry
- **WHEN** a retained operation identity is reused with different request content
- **THEN** the system rejects the conflict without executing the new content

#### Scenario: Retry after retirement
- **WHEN** a delayed request names an operation whose receipt has been retired
- **THEN** the system rejects it as outside the retry window without executing it again or claiming an unverified successful outcome

#### Scenario: Unresolved work fills the window
- **WHEN** genuinely unresolved operations consume the configured window
- **THEN** the system reports bounded backpressure, preserves retry evidence, and does not silently drop or replay input
- **AND** settlement and receipt retirement can restore admission without consuming ordinary mutation capacity

### Requirement: Retention recovery preserves terminal ownership
Receipt-retirement state SHALL survive supported daemon replacement and controller transitions. Recovery SHALL preserve live PTY identities and reject stale controllers and expired operation identities. Unsupported compatibility transitions SHALL fail explicitly without silently resetting retry safety or terminating live sessions.

#### Scenario: Controller reconnects after retirement
- **WHEN** a controller reconnects after receipts have been retired
- **THEN** it reconciles live sessions and retry-window state before new mutations, and old requests cannot execute again

#### Scenario: Daemon replacement
- **WHEN** a supported daemon replacement occurs after receipt retirement with requests still unresolved
- **THEN** the restored daemon preserves retirement boundaries, unresolved results, PTY input ordering, and live session identities

#### Scenario: Existing exhausted history
- **WHEN** a supported upgrade encounters an exhausted legacy receipt history
- **THEN** recovery fences legacy requests before reclaiming their history, preserves live sessions, and resumes new mutations without automatically resubmitting uncertain work
#### Scenario: Attachment to a legacy daemon
- **WHEN** the app attaches to a daemon that lacks receipt-retirement support
- **THEN** the app attempts supported in-place replacement with its selected daemon image before admitting new terminal mutations, then reconciles the preserved PTYs
- **AND** unsupported or failed replacement reports an explicit failure without killing sessions or launching a second owner


### Requirement: Distinguishable terminal capacity failures
The terminal system SHALL distinguish receipt-window pressure, retained-request byte pressure, and live-session capacity failures in returned errors and read-only diagnostics. Diagnostics SHALL omit terminal input payloads and secrets.

#### Scenario: Operation retention blocks input
- **WHEN** a terminal mutation is refused because its retry window is full
- **THEN** the reported reason identifies operation retention rather than implying too many live terminals, and diagnostics expose the relevant usage and limit

#### Scenario: Input refusal with continued output
- **WHEN** input is refused while the PTY continues producing output
- **THEN** the caller receives an explicit input failure and the terminal remains identified as live
