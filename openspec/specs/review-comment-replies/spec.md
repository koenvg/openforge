# review-comment-replies Specification

## Purpose

Preserve GitHub review comment reply relationships in the local cache so the Review tab can show existing conversations as threads.

## Requirements

### Requirement: Cached comments carry their reply parent

The cached pull request comment store SHALL record the comment that each comment replies to, or no parent when the comment starts a thread. General pull request comments and review summaries SHALL always be thread roots.

#### Scenario: Review reply is read from GitHub

- **WHEN** the system reads a pull request whose review comments include a reply
- **THEN** the cached reply records the comment it answers
- **AND** the answered comment records no reply parent

#### Scenario: Non-threaded comment is read from GitHub

- **WHEN** the system reads a general pull request comment or review summary
- **THEN** the cached comment records no reply parent

### Requirement: Existing cached comments heal on the next read

Comments cached before reply parents were recorded SHALL gain their reply parent the next time the system reads them from GitHub. Updating the reply parent SHALL leave the comment's addressed state unchanged.

#### Scenario: Previously cached reply is read again

- **WHEN** the next scheduled pull request read finds a cached reply with no stored parent
- **THEN** the cached reply records its parent from GitHub
- **AND** its addressed state is unchanged

### Requirement: The public comment contract carries thread identity

The public `PrComment` SDK type SHALL require a nullable reply-parent field. A null value SHALL identify a thread root.

#### Scenario: Plugin code constructs a comment

- **WHEN** plugin code or a fixture constructs a `PrComment`
- **THEN** it supplies the parent comment id for a reply
- **OR** it supplies null for a thread root

### Requirement: The Review tab nests cached replies

The Review tab diff SHALL show each cached review reply beneath the comment it answers instead of as a separate comment card on the same line.

#### Scenario: Reviewer thread is opened

- **WHEN** a user opens a task whose pull request has a cached review comment and its reply
- **THEN** the diff shows the reply beneath the parent comment
- **AND** the reply is not shown as a separate root card

### Requirement: Database upgrade remains backward compatible

The database change SHALL be additive. An older OpenForge build SHALL still be able to open a database after a newer build adds reply-parent storage.

#### Scenario: Older build opens an upgraded database

- **WHEN** a newer build has added reply-parent storage to an existing database
- **THEN** an older build can open and read that database without removing the new data
