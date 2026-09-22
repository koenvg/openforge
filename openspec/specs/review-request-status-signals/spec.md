# review-request-status-signals Specification

## Purpose

Tell a reviewer whether a pull request on the Review Requests list is still worth their time: whether its checks pass, and whether it has already merged or closed.

## Requirements

### Requirement: Report the check state of a review request
The system SHALL report, for each pull request on the Review Requests list, whether the pull request's checks pass, fail, or are still running. The system SHALL derive that state from the same check aggregation it uses for pull requests the user authored. The system SHALL report no check state for a pull request that publishes no checks, rather than reporting a placeholder or a default state.

#### Scenario: Every check passed
- **WHEN** all checks on a review request's head commit completed successfully
- **THEN** the system reports that review request's checks as passing

#### Scenario: A check failed
- **WHEN** a check on a review request's head commit completed unsuccessfully
- **THEN** the system reports that review request's checks as failing

#### Scenario: Checks are still running
- **WHEN** a check on a review request's head commit has not completed
- **THEN** the system reports that review request's checks as running

#### Scenario: The pull request publishes no checks
- **WHEN** a review request's head commit has no checks and no commit statuses
- **THEN** the system reports no check state for that review request

#### Scenario: The author pushes a new commit
- **WHEN** a review request's checks passed and the author then pushes a commit whose checks fail
- **THEN** the system reports that review request's checks as failing rather than as passing

### Requirement: Report that a review request merged or closed
The system SHALL report, for each pull request on the Review Requests list, that the pull request merged, or that it closed without merging. A pull request that GitHub reports as merged SHALL read as merged, not as closed.

#### Scenario: The pull request merged
- **WHEN** a review request merged
- **THEN** the system reports that review request as merged

#### Scenario: The pull request closed unmerged
- **WHEN** a review request closed and did not merge
- **THEN** the system reports that review request as closed

#### Scenario: The pull request is still open
- **WHEN** a review request is open
- **THEN** the system reports that review request as neither merged nor closed

### Requirement: Drop open-work signals once a review request is finished
The system SHALL NOT report check state or merge readiness for a pull request it reports as merged or as closed. A finished review request SHALL carry only its finished state, so one card never reports both a merge outcome and pending work.

#### Scenario: A pull request merged with a failing check
- **WHEN** a review request merged and its last known check state was failing
- **THEN** the system reports that review request as merged and reports no check state for it

#### Scenario: A pull request closed while checks were running
- **WHEN** a review request closed unmerged and its last known check state was running
- **THEN** the system reports that review request as closed and reports no check state for it

### Requirement: Keep the signals in step with GitHub
The system SHALL refresh the check state and the merge state of a review request from the same synchronisation that already maintains the Review Requests list, and SHALL produce the same signals whether the user asked for the refresh or a background poll ran it.

The Review Requests list keeps a pull request after GitHub stops asking the user to review it. The system SHALL resolve the merge state of such a kept pull request, so it does not keep reading as open work.

When the system cannot obtain a signal from GitHub, it SHALL keep the last known value of that signal and SHALL keep the pull request on the list, rather than clearing the signal or dropping the pull request.

#### Scenario: A kept pull request merges
- **WHEN** GitHub stops asking the user to review a pull request that the list kept, and that pull request merged
- **THEN** the system reports that review request as merged

#### Scenario: Checks turn red while the app is open
- **WHEN** synchronisation observes that a review request's passing checks now fail
- **THEN** the system reports that review request's checks as failing without the user opening GitHub

#### Scenario: The user refreshes by hand
- **WHEN** the user refreshes the Review Requests list
- **THEN** the system reports the same check state and merge state that a background poll would report

#### Scenario: A check fetch fails
- **WHEN** synchronisation cannot read a review request's checks
- **THEN** the system keeps reporting that review request's last known check state and keeps the pull request on the list

#### Scenario: A merge-state fetch fails
- **WHEN** synchronisation cannot read the state of a kept pull request
- **THEN** the system keeps reporting that review request as open and keeps it on the list

### Requirement: Obtain the signals without repeated downloads
The system SHALL request review-request check data conditionally, so a synchronisation that finds an unchanged head commit neither re-downloads the check data nor consumes GitHub request quota for it. The system SHALL resolve merge state only for pull requests the review search no longer returns, not for every pull request on the list.

#### Scenario: Head commit unchanged between two synchronisations
- **WHEN** synchronisation reads the checks of a review request whose head commit has not changed since the previous synchronisation
- **THEN** the system reuses the check data it already holds and consumes no GitHub request quota for that read

#### Scenario: The pull request is still in the review search
- **WHEN** GitHub still asks the user to review a pull request on the list
- **THEN** the system resolves no separate merge state for that pull request

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
