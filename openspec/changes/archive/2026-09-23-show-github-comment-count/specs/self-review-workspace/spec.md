## ADDED Requirements

### Requirement: GitHub comments tab shows its thread count

The Self Review panel SHALL show a numeric badge on the GitHub comments tab when the tab has one or more GitHub review thread roots. The count SHALL include all thread roots available to the tab, including addressed threads, and SHALL NOT count replies as separate items. The tab SHALL omit the badge when the count is zero and SHALL keep a count-aware accessible name whenever the badge is shown.

#### Scenario: Comments are available while another tab is selected

- **WHEN** the GitHub comments tab has review thread roots and Changed files is selected
- **THEN** the GitHub comments toggle shows a badge with the number of thread roots
- **AND** the panel remains on Changed files

#### Scenario: Replies and addressed threads contribute consistently

- **WHEN** the GitHub comment data contains an addressed thread root, an unaddressed thread root, and replies within either thread
- **THEN** the badge counts both thread roots
- **AND** the replies do not increase the badge count

#### Scenario: No GitHub comment threads exist

- **WHEN** the GitHub comments tab has no review thread roots
- **THEN** the toggle shows no numeric badge
- **AND** its accessible name remains "GitHub comments"

#### Scenario: GitHub comment count changes

- **WHEN** a refresh or comment update changes the number of GitHub review thread roots
- **THEN** the visible badge and tab accessible name update to the new count
- **AND** the selected tab and panel visibility remain unchanged
