## Purpose

Defines the Terminal Runtime behavior that keeps PTY identity, authoritative terminal state, temporary view attachments, recovery, and geometry control consistent across asynchronous events.

## ADDED Requirements

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
