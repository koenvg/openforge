## ADDED Requirements

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
