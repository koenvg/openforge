## ADDED Requirements

### Requirement: Live reattachment across controller replacement
The Terminal Runtime SHALL reattach a surviving PTY by its Shell Session Key and current PTY instance identity after Electron or Sidecar replacement. Transport restoration MUST NOT select a new PTY, invoke a provider resume, or report process exit without authoritative liveness evidence. Terminal input MUST remain unavailable until the current controller and PTY identities are reconciled.

#### Scenario: New renderer attaches to surviving agent
- **WHEN** a replacement renderer acquires a Terminal Session whose PTY survived the restart
- **THEN** it attaches to the current PTY instance, restores the selected authority's recovery state before later live output, and does not request another process

#### Scenario: Connection is temporarily unavailable
- **WHEN** a live Terminal Session loses its transport during a coordinated restart
- **THEN** it reports unavailable control separately from process liveness and does not infer shell exit from disconnection or a presentation reset

### Requirement: Controller generation safety
Terminal operations and asynchronous completions SHALL be associated with the controller generation as well as the current PTY and attachment identities. Work from a superseded controller MUST NOT mutate the replacement controller's terminal state even when the PTY instance itself survives unchanged.

#### Scenario: Old controller replay arrives late
- **WHEN** a replay requested through the old controller resolves after the replacement controller becomes current for the same PTY
- **THEN** the Terminal Runtime rejects that completion and obtains recovery state through the current controller

#### Scenario: Old resize arrives after reattachment
- **WHEN** a resize from the previous controller or a superseded attachment arrives after the new view acquires geometry ownership
- **THEN** it does not resize the surviving PTY or revoke the current geometry owner

### Requirement: Handoff output recovery
Terminal reattachment SHALL join recovery state to live output using the daemon's current output position. It MUST discard already-recovered output, detect retention gaps, and preserve bounded transitional queues. Reattaching to a retained exited session MUST display historical terminal state without accepting live input.

#### Scenario: Output arrives during reattachment
- **WHEN** output for the surviving PTY arrives while its replacement view is restoring recovery state
- **THEN** the runtime presents retained recovery state first and then only newer contiguous output for the current controller and PTY

#### Scenario: Retained exit is reconciled
- **WHEN** recovery identifies that the selected PTY exited while the interface was absent
- **THEN** the view displays retained output with inactive input and does not treat the existence of replay bytes as proof of liveness
