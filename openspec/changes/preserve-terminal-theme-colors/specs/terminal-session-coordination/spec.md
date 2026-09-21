## ADDED Requirements

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
