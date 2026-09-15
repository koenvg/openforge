## Purpose

Tell a task owner who is reviewing the task's pull request and what each reviewer decided, so they can chase the right person without leaving the app for GitHub.

## ADDED Requirements

### Requirement: List every reviewer of a task's pull request
The system SHALL present, for each pull request linked to a task, every reviewer that submitted a review on the pull request and every reviewer the pull request asked for. Reviewers SHALL include individual users, review teams, and automated reviewers.

#### Scenario: A person submitted a review
- **WHEN** a person submitted a review on the pull request
- **THEN** the system presents that person as a reviewer of the pull request

#### Scenario: A person was asked but has not reviewed
- **WHEN** the pull request asks a person for review and that person has not submitted a review
- **THEN** the system presents that person as a reviewer of the pull request

#### Scenario: A team was asked to review
- **WHEN** the pull request asks a team for review
- **THEN** the system presents that team as a single reviewer of the pull request

#### Scenario: An automated reviewer submitted a review
- **WHEN** an automated reviewer submitted a review on the pull request
- **THEN** the system presents that automated reviewer as a reviewer of the pull request

### Requirement: Report each reviewer's own verdict
The system SHALL report a verdict for each presented reviewer, distinguishing approved, changes requested, commented, dismissed, and pending. When a reviewer submitted more than one review, the system SHALL report the verdict of that reviewer's most recent review that carries a decision, and SHALL NOT let an earlier review of the same reviewer override it.

#### Scenario: Reviewer approved
- **WHEN** a reviewer's most recent decision on the pull request is an approval
- **THEN** the system reports that reviewer as approved

#### Scenario: Reviewer asked for changes
- **WHEN** a reviewer's most recent decision on the pull request asks for changes
- **THEN** the system reports that reviewer as having requested changes

#### Scenario: Reviewer only commented
- **WHEN** a reviewer submitted reviews on the pull request and none of them carries a decision
- **THEN** the system reports that reviewer as having commented

#### Scenario: Reviewer's approval was dismissed
- **WHEN** a reviewer's approval on the pull request was dismissed
- **THEN** the system reports that reviewer as dismissed rather than as approved or pending

#### Scenario: Reviewer has not reviewed yet
- **WHEN** the pull request asks a reviewer for review and that reviewer has submitted no review
- **THEN** the system reports that reviewer as pending

#### Scenario: Reviewer asked again after approving
- **WHEN** a reviewer approved the pull request and the pull request then asks that same reviewer for review again
- **THEN** the system reports that reviewer as pending

#### Scenario: Reviewer changed their mind
- **WHEN** a reviewer asked for changes on the pull request and later approved it
- **THEN** the system reports that reviewer as approved

### Requirement: Order reviewers by what holds the pull request
The system SHALL order presented reviewers so that reviewers holding the pull request appear before reviewers that do not. Reviewers that requested changes SHALL come first, then pending reviewers, then reviewers that only commented or were dismissed, then reviewers that approved.

#### Scenario: A mix of verdicts
- **WHEN** a pull request has one approving reviewer, one pending reviewer, and one reviewer that requested changes
- **THEN** the system presents the reviewer that requested changes first, then the pending reviewer, then the approving reviewer

### Requirement: Omit the reviewer presentation when there is nothing to report
The system SHALL omit the reviewer presentation for a pull request that has no submitted reviews and no review requests, rather than presenting an empty list or a placeholder.

#### Scenario: Nobody reviewed and nobody was asked
- **WHEN** a pull request has no submitted reviews and asks nobody for review
- **THEN** the system presents no reviewer list for that pull request

### Requirement: Keep reviewers in step with GitHub without extra requests
The system SHALL update presented reviewers from the same pull request synchronisation that already maintains a task pull request's state, and SHALL NOT issue additional GitHub requests to obtain reviewers. When synchronisation fails, the system SHALL keep the last known reviewers visible rather than clearing them.

#### Scenario: A reviewer approves while the app is open
- **WHEN** synchronisation observes a new approval on a task's pull request
- **THEN** the system presents that reviewer as approved without the user opening GitHub

#### Scenario: A reviewer is removed from the pull request
- **WHEN** synchronisation observes that a pull request no longer asks a pending reviewer for review and that reviewer submitted no review
- **THEN** the system stops presenting that reviewer

#### Scenario: Synchronisation cannot reach GitHub
- **WHEN** synchronisation of a task's pull request fails
- **THEN** the system keeps presenting the last known reviewers and their verdicts

### Requirement: Identify reviewers and verdicts accessibly
The system SHALL expose each presented reviewer so that assistive technology can report both the reviewer's identity and that reviewer's verdict.

#### Scenario: Assistive technology inspects the reviewer list
- **WHEN** assistive technology inspects a presented reviewer
- **THEN** it reports the reviewer's identity and that reviewer's verdict
