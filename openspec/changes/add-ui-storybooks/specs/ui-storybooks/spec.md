## Purpose

Provide complete, deterministic catalogs of OpenForge pages and visual modules so developers can iterate on design and reviewers can compare repository-managed screenshots without running the desktop backend.

## ADDED Requirements

### Requirement: Separate page and component catalogs
The system SHALL provide independently runnable and independently buildable catalogs for page-level UI and component-level UI.

#### Scenario: Develop page stories
- **WHEN** a developer starts the page catalog
- **THEN** the system serves only the page-level story hierarchy with the shared OpenForge presentation and fixtures available

#### Scenario: Develop component stories
- **WHEN** a developer starts the component catalog
- **THEN** the system serves only the component-level story hierarchy with the shared OpenForge presentation and fixtures available

#### Scenario: Build static catalogs
- **WHEN** a developer or CI builds both catalogs
- **THEN** the system produces separate static outputs for the page and component catalogs

### Requirement: Complete page and plugin-contribution coverage
The page catalog SHALL include every application page and every visual contribution from each bundled plugin in the host context where that contribution normally appears.

#### Scenario: Browse application pages
- **WHEN** a developer opens the page catalog
- **THEN** each application route or full-page destination is available with representative populated, empty, loading, and failure stories where those states exist

#### Scenario: Browse bundled plugin UI
- **WHEN** a bundled plugin contributes a full-page view, task-pane tab, settings section, row action, status section, or other visual extension
- **THEN** the page catalog includes that contribution inside a representative host context

#### Scenario: Detect missing page coverage
- **WHEN** an application destination or bundled plugin visual contribution is added without catalog coverage or an explicit non-visual exclusion
- **THEN** catalog validation fails and identifies the uncovered item

### Requirement: Complete visual module coverage
The component catalog SHALL include every reusable or visually distinct UI module owned by the host renderer, shared UI packages, and bundled plugins, except modules that render no interface or exist only as test wrappers or registration shims.

#### Scenario: Browse a visual module
- **WHEN** a developer selects a covered visual module
- **THEN** the catalog presents its relevant visual states, including applicable default, selected, disabled, loading, empty, error, attention, narrow-layout, and overflow states

#### Scenario: Exclude a non-visual module
- **WHEN** a provider, host, registration shim, or test wrapper has no independently visible interface
- **THEN** the coverage inventory may exclude it with a recorded reason

#### Scenario: Detect missing component coverage
- **WHEN** a reusable or visually distinct UI module is added without stories or an allowed exclusion
- **THEN** catalog validation fails and identifies the uncovered module

### Requirement: Production presentation fidelity
Both catalogs SHALL render source UI modules with the production OpenForge styles, fonts, theme variables, and relevant layout constraints.

#### Scenario: Render a themed story
- **WHEN** a developer opens a story under a supported OpenForge theme
- **THEN** the story uses the same theme tokens and global styling as the desktop renderer

#### Scenario: Inspect layout behavior
- **WHEN** a story declares a desktop, narrow, or component-sized viewport
- **THEN** the rendered UI receives the corresponding layout constraints without requiring the Electron shell

### Requirement: Deterministic isolated scenarios
Stories SHALL use deterministic fixture data and local adapters for desktop, plugin, filesystem, browser-surface, terminal, and backend interactions instead of requiring live OpenForge runtime data or external services.

#### Scenario: Open a story without the desktop backend
- **WHEN** either catalog runs in a browser with no Electron bridge or sidecar
- **THEN** every included story reaches its declared state without an unhandled runtime dependency error

#### Scenario: Repeat an interactive story
- **WHEN** an interaction scenario is run more than once
- **THEN** each run starts from the same fixture state and produces the same observable result

#### Scenario: Exercise a failure state
- **WHEN** a story selects a failing local adapter response
- **THEN** the source UI displays its normal failure behavior without contacting a live service

### Requirement: Repository-managed visual snapshots
The system SHALL capture deterministic screenshots for the declared page and component story matrix and SHALL store approved baseline images in the repository.

#### Scenario: Compare unchanged UI
- **WHEN** the snapshot check runs against UI that matches the approved baselines
- **THEN** every screenshot comparison passes without modifying repository files

#### Scenario: Review a visual change
- **WHEN** a captured screenshot differs from its approved baseline
- **THEN** the check fails and produces the baseline, current, and visual-difference images under stable story identifiers so a reviewer can inspect the before and after

#### Scenario: Approve an intentional visual change
- **WHEN** a developer runs the explicit snapshot-update command
- **THEN** only the affected repository baseline images change and those image changes can be included in code review

#### Scenario: Remove stale snapshots
- **WHEN** a covered story is removed or renamed
- **THEN** snapshot validation identifies the stale baseline instead of silently retaining it

### Requirement: Stable screenshot capture environment
Visual snapshot capture SHALL control browser version, viewport, device scale, fonts, time, animation, and fixture completion so equivalent source produces equivalent screenshots in local and CI runs.

#### Scenario: Capture after story readiness
- **WHEN** a story performs asynchronous setup or interaction
- **THEN** the snapshot runner waits for the story's declared ready state before capturing

#### Scenario: Encounter an unstable story
- **WHEN** a story does not reach readiness or produces inconsistent output
- **THEN** the snapshot check fails with the story identifier and diagnostics rather than approving a variable baseline

### Requirement: Continuous catalog validation
The repository SHALL provide documented commands that validate story coverage, build both catalogs, and compare visual snapshots, and CI SHALL run those checks for affected UI changes.

#### Scenario: Validate a pull request
- **WHEN** CI evaluates a change that affects cataloged UI or story infrastructure
- **THEN** it verifies coverage, both static builds, and the visual snapshot matrix

#### Scenario: Catalog validation failure
- **WHEN** coverage, a static build, story readiness, or screenshot comparison fails
- **THEN** the command exits unsuccessfully and identifies the catalog and story responsible
