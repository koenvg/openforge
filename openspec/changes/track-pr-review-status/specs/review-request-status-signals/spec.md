## ADDED Requirements

### Requirement: Track review completion for one pull request version
The system SHALL let the user mark an open review request's current head commit as reviewed and mark it as needing review again. A successful GitHub review submitted through OpenForge SHALL mark the commit submitted with that review as reviewed. Review completion SHALL remain independent from whether the user opened the pull request, marked it unread, or GitHub still requests their review.

#### Scenario: User marks the current version reviewed
- **WHEN** the user marks an open pull request at head `abc123` as reviewed
- **THEN** the system records `abc123` as that pull request's reviewed version
- **AND** the pull request reports `Reviewed`

#### Scenario: User reverses the reviewed mark
- **WHEN** the user marks a reviewed open pull request as needing review
- **THEN** the system clears its reviewed version
- **AND** the pull request reports `Review needed`

#### Scenario: OpenForge submits a GitHub review
- **WHEN** OpenForge successfully submits a GitHub review for commit `abc123`
- **THEN** the system records `abc123` as the pull request's reviewed version

#### Scenario: Unread state changes
- **WHEN** the user opens a pull request, marks it unread, or clears its unread state
- **THEN** its reviewed version and review-progress status remain unchanged

### Requirement: Return updated pull requests to review work
The system SHALL compare an open pull request's reviewed version with its current head commit. An open pull request with no reviewed version SHALL report `Review needed`; one whose reviewed version equals its current head SHALL report `Reviewed`; and one whose reviewed version differs from its current head SHALL report `Updated since review`. The system SHALL retain the earlier reviewed version until the user reviews the new head or explicitly marks the pull request as needing review.

#### Scenario: Author pushes after review
- **WHEN** the user reviewed head `abc123` and synchronisation observes a new head `def456`
- **THEN** the pull request reports `Updated since review`
- **AND** it returns to the work that needs the user's attention

#### Scenario: User reviews the update
- **WHEN** a pull request reports `Updated since review` at head `def456` and the user marks it reviewed
- **THEN** the reviewed version becomes `def456`
- **AND** the pull request reports `Reviewed`

#### Scenario: Submitted review races with a new commit
- **WHEN** OpenForge successfully submits a GitHub review for `abc123` after synchronisation has observed head `def456`
- **THEN** the system records `abc123` as reviewed
- **AND** the pull request reports `Updated since review` rather than `Reviewed`

### Requirement: Separate review work from completed reviews
The Review Requests view SHALL place open pull requests that report `Review needed` or `Updated since review` in a visible `Needs your review` group. It SHALL place open pull requests that report `Reviewed` in a separate `Reviewed` group that is collapsed by default. Each group SHALL report its own count, and each card SHALL expose its review-progress state with text rather than color alone. Merged and closed pull requests SHALL remain governed by the existing finished-state presentation instead of either open-work group.

#### Scenario: Review Requests view opens
- **WHEN** the view contains open pull requests that need review and open pull requests already reviewed at their current heads
- **THEN** the needs-review pull requests are visible in `Needs your review`
- **AND** the reviewed pull requests are hidden in the collapsed `Reviewed` group
- **AND** both group labels report their respective counts

#### Scenario: User expands reviewed pull requests
- **WHEN** the user expands the `Reviewed` group
- **THEN** its reviewed pull request cards become visible
- **AND** each card reports `Reviewed`

#### Scenario: Reviewed pull request receives a new commit
- **WHEN** synchronisation changes a reviewed open pull request to `Updated since review`
- **THEN** it leaves the `Reviewed` group
- **AND** it appears in the visible `Needs your review` group with that status

#### Scenario: Pull request finishes after review
- **WHEN** a reviewed pull request merges or closes
- **THEN** it leaves the `Reviewed` group
- **AND** it appears only in the existing finished review-request presentation
