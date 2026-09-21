## Purpose

Allow clickable terminal PR labels to trigger verified task association even when their GitHub URL is not visible in the label.

## ADDED Requirements

### Requirement: Hyperlink targets trigger PR discovery

The system SHALL recognize complete HTTP or HTTPS github.com pull request URLs in OSC 8 hyperlink targets from accepted live task-owned terminal output. Recognition SHALL trigger the existing task-scoped verification without waiting for agent completion or periodic polling, independently of the visible label or terminal view attachment.

#### Scenario: Short clickable PR label
- **WHEN** a current task terminal emits an OSC 8 link to `https://github.com/acme/widgets/pull/2549` with the label `PR #2549`
- **THEN** the system schedules verification of PR 2549 for the owning task as soon as the hyperlink opening sequence is complete
- **AND** it does not require a visible URL or a subsequent hyperlink closing sequence

#### Scenario: Daemon-backed task terminal remains running
- **WHEN** a current daemon-backed task terminal emits a valid hyperlink target and continues running
- **THEN** the system verifies and links an eligible PR without waiting for process exit, terminal attachment, or periodic polling

#### Scenario: Daemon output is duplicated or interrupted
- **WHEN** daemon output repeats an already consumed sequence, arrives for an old PTY identity, or has a sequence gap
- **THEN** duplicate and stale output cannot trigger discovery and incomplete framing is discarded across the gap

#### Scenario: Supported sequence forms
- **WHEN** an OSC 8 opening sequence has empty parameters or nonempty parameters such as `id=pr-2549`, and ends with BEL or ESC followed by backslash
- **THEN** the system recognizes its valid GitHub PR target identically for each form

#### Scenario: Output split across chunks
- **WHEN** a valid hyperlink opening sequence is split at any byte boundary across contiguous accepted output chunks
- **THEN** the system emits no candidate until the complete sequence terminator arrives
- **AND** it recognizes the same complete PR identity as an unsplit sequence

### Requirement: Hyperlinks preserve discovery safety

The system SHALL treat a hyperlink target only as a candidate, subject to the same canonical deduplication, repository and branch verification, ownership protection, and current-session checks as visible PR URLs. The system SHALL NOT infer a candidate from a bare PR number or use link parameters or labels as repository authority.

#### Scenario: Target does not match the task
- **WHEN** a clickable PR target fails the existing GitHub repository or branch verification
- **THEN** the system does not associate it with the task

#### Scenario: Repeated or visible copy of the target
- **WHEN** the same canonical PR appears in repeated hyperlinks and visible URLs within the existing deduplication window
- **THEN** these representations share the existing duplicate suppression behavior

#### Scenario: Unowned or stale output
- **WHEN** a hyperlink occurs in replayed output, a superseded session, or a terminal without authoritative task ownership
- **THEN** it does not trigger task PR discovery

#### Scenario: Plain PR reference
- **WHEN** the terminal prints only `Created PR #2549` without a hyperlink target or full visible PR URL
- **THEN** that text does not itself create a PR candidate
- **AND** existing completion and reconciliation discovery remain available

### Requirement: Terminal metadata parsing remains bounded and isolated

The system SHALL retain at most 2 KiB of an in-progress hyperlink payload, discard malformed or oversized candidates, and ignore empty closing targets, unsupported hosts, other OSC commands, and DCS payloads. It SHALL NOT combine visible text with hidden payload bytes to manufacture a URL. Output discontinuities SHALL discard incomplete hyperlink state. Parsing SHALL remain nonblocking with respect to GitHub requests.

#### Scenario: Other metadata contains a PR URL
- **WHEN** a terminal title OSC, another non-hyperlink OSC, or a DCS payload contains a valid-looking PR URL
- **THEN** it does not produce a PR candidate

#### Scenario: Invalid or oversized hyperlink
- **WHEN** an OSC 8 payload is malformed, exceeds the bound, contains unsupported control bytes, or has a non-GitHub target
- **THEN** it produces no PR candidate
- **AND** after its terminator the parser can recognize a subsequent valid hyperlink

#### Scenario: Empty closing target
- **WHEN** an OSC 8 closing sequence supplies an empty target
- **THEN** it produces no candidate and does not reuse the preceding target

#### Scenario: Gap or session replacement
- **WHEN** an output gap or session replacement occurs before a hyperlink opening sequence is complete
- **THEN** later bytes cannot complete the discarded candidate

#### Scenario: Ordinary URLs remain supported
- **WHEN** accepted output contains a complete visible PR URL, including supported color styling
- **THEN** it retains existing recognition and verification behavior
