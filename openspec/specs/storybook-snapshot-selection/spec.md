# storybook-snapshot-selection Specification

## Purpose

Keep canonical screenshot coverage focused on distinct visual risks while retaining development stories and reviewable evidence for removed cases.

## Requirements

### Requirement: Reviewable snapshot selection
Canonical snapshot selection SHALL record each retained visual risk and, for each removed case, the retained screenshot or behavioral assertion that covers its purpose and the reason a separate baseline is unnecessary. Selection SHALL preserve distinct responsive layouts, overflow, theme-sensitive appearances, focus and overlays, media and terminal renderers, and documented visual regressions.

#### Scenario: Redundant state is removed
- **WHEN** a case is removed because its only unique purpose is business-state mapping
- **THEN** the coverage record identifies a behavioral assertion for that mapping and retained screenshot coverage for its appearance
- **AND** the original story remains available for development

#### Scenario: A case protects a unique visual risk
- **WHEN** a proposed removal has no retained coverage for its distinct visual risk
- **THEN** the case remains selected until equivalent coverage is reviewed

### Requirement: Readable representative galleries
Gallery snapshots SHALL show every represented variant without clipping or overlap at their declared viewport, with identifiable variant labels. Theme-sensitive shared variants SHALL retain light and dark visual coverage. Galleries SHALL NOT replace distinct interaction or responsive layout coverage solely because they contain the same component.

#### Scenario: Status variants are consolidated
- **WHEN** multiple status snapshots are replaced by a gallery
- **THEN** reviewers can identify and inspect every represented status in the resulting screenshots
- **AND** isolated stories remain available
- **AND** separate layout or interaction risks retain their own coverage

### Requirement: Selection preserves execution safeguards
Curating cases SHALL preserve full baseline comparison and independent repeatability verification for every selected case, existing readiness and diagnostic checks, and existing pixel tolerances. Required runner-probe representatives SHALL remain available. Obsolete approved images SHALL be explicitly reviewed and removed, never silently accepted or automatically regenerated to make tests pass.

#### Scenario: Curated matrix is validated
- **WHEN** the canonical visual test succeeds after curation
- **THEN** every selected case has passed baseline comparison and repeatability verification
- **AND** no missing, obsolete, or unexpected baseline is ignored
- **AND** runner and targeted regression probes still pass
