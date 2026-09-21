## ADDED Requirements

### Requirement: Completed restoration presentation
The Terminal Runtime SHALL conceal intermediate terminal contents during authoritative restoration and SHALL reveal only a completed restored screen for the current visible attachment. Concealment SHALL preserve layout dimensions and SHALL NOT change Terminal Session or PTY liveness.

#### Scenario: First opening a task with long output history
- **WHEN** a task terminal restores saved output across multiple rendering frames on first open
- **THEN** the user does not see history scrolling through the terminal during restoration
- **AND** the first revealed terminal frame contains the completed restored screen rather than an intermediate replay state
- **AND** restored scrollback remains available within existing retention limits

#### Scenario: Historical output without a live PTY
- **WHEN** a terminal restores historical output without a current PTY
- **THEN** the completed historical screen is revealed without intermediate playback
- **AND** the session remains inactive

#### Scenario: Images and live output during restoration
- **WHEN** saved history includes supported inline images and newer live output arrives during restoration
- **THEN** restoration preserves supported images and terminal state
- **AND** newer output is presented only in the existing authoritative ordering after restoration
- **AND** intermediate historical image and text frames are not exposed

#### Scenario: Replacement superseded or detached
- **WHEN** restoration is superseded, its attachment becomes hidden or detached, or its view is disposed before completion
- **THEN** the obsolete completion does not reveal or focus a replacement attachment
- **AND** returning to a current visible attachment can complete recovery and reveal its restored screen

#### Scenario: Restoration fails and is retried
- **WHEN** restoration fails for a current visible attachment
- **THEN** incomplete replay contents remain concealed
- **AND** existing recovery behavior remains available
- **AND** a successful retry reveals the completed screen rather than leaving it permanently concealed

#### Scenario: Empty terminal and ordinary live output
- **WHEN** an empty terminal finishes restoration or an already restored terminal receives ordinary live output
- **THEN** the runtime introduces no deliberate loading delay
- **AND** ordinary live output is not concealed as history restoration
