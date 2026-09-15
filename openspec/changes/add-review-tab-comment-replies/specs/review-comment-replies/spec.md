## Purpose

Let a task author answer a GitHub reviewer from inside the Review tab, and keep a comment out of the unaddressed counts for exactly as long as the reviewer has nothing new to say.

## ADDED Requirements

### Requirement: Cached comments carry their reply parent

The cached pull request comment store SHALL record, for every comment it holds, the comment that comment replies to, or nothing when the comment starts a thread. A comment that starts a thread is its thread root. General pull request comments and review summaries SHALL always be thread roots.

Comments cached before this capability existed SHALL gain their reply parent the next time the system reads them from GitHub. The system SHALL NOT require the user to re-link the pull request or clear local data to obtain it.

#### Scenario: Reply is read from GitHub

- **WHEN** the system reads a pull request whose review comments include a reply
- **THEN** the cached reply records the comment it answers
- **AND** the answered comment records no reply parent

#### Scenario: Comment cached before the reply parent was recorded

- **WHEN** the system reads a pull request holding comments cached without a reply parent
- **THEN** those comments gain their reply parent from that read
- **AND** their addressed state is unchanged

#### Scenario: Comment with no diff location

- **WHEN** the system caches a general pull request comment or a review summary
- **THEN** it is recorded as a thread root

### Requirement: Inline code comments accept a reply

The Review tab SHALL offer a reply box on each inline code comment shown in the diff, and SHALL NOT offer one anywhere else. Submitting it SHALL post a threaded reply to that comment's thread on GitHub.

The reply box SHALL be offered only while the task has a linked open pull request. It SHALL be offered on a comment GitHub reports as outdated. It SHALL NOT be offered on a reply, because a reply's thread is answered through its root.

#### Scenario: Reply to a reviewer

- **WHEN** the user submits a reply on an inline code comment
- **THEN** the reply is posted to that comment's thread on the pull request

#### Scenario: Comment list offers no reply

- **WHEN** the user views the same comments in the review panel's comment list
- **THEN** no reply box is offered there

#### Scenario: Outdated comment

- **WHEN** an inline code comment is marked outdated
- **THEN** a reply box is still offered on it

#### Scenario: Reply shown inline

- **WHEN** an inline code comment already has replies
- **THEN** the replies are shown beneath it
- **AND** no reply box is offered on the replies themselves

### Requirement: A posted reply appears without waiting for a refresh

Once GitHub accepts a reply, the Review tab SHALL show it beneath the comment it answers before the next scheduled read of the pull request. A later read of the same reply SHALL NOT produce a duplicate.

#### Scenario: Reply is visible immediately

- **WHEN** GitHub accepts a reply the user submitted
- **THEN** the reply is shown beneath the comment it answers
- **AND** the user does not have to refresh the diff or reopen the task to see it

#### Scenario: Scheduled read finds the same reply

- **WHEN** the system next reads the pull request after the user posted a reply
- **THEN** the reply is shown once

### Requirement: Replying addresses the comment until the reviewer answers again

Replying to a comment SHALL mark that comment's thread root addressed. When a comment authored by anyone other than the signed-in user is later added to that thread, the thread root SHALL return to unaddressed.

Marking addressed SHALL be treated as a local convenience. When GitHub accepts a reply but the system cannot record the addressed state, the system SHALL keep the accepted reply and SHALL NOT re-send it.

#### Scenario: Reply marks the thread addressed

- **WHEN** the user replies to an unaddressed inline code comment
- **THEN** that comment is addressed
- **AND** it no longer counts towards the task's unaddressed comment count

#### Scenario: Reviewer answers again

- **WHEN** a reply from another author is added to a thread the user had addressed
- **THEN** the thread root is unaddressed again
- **AND** it counts towards the task's unaddressed comment count again

#### Scenario: The user replies twice

- **WHEN** the user adds a second reply of their own to a thread they already addressed
- **THEN** the thread root stays addressed

#### Scenario: Reply accepted but addressed state not recorded

- **WHEN** GitHub accepts a reply and recording the addressed state fails
- **THEN** the reply remains posted and visible
- **AND** the user is not asked to send it again

#### Scenario: Reply rejected

- **WHEN** GitHub rejects a reply
- **THEN** the comment stays unaddressed
- **AND** the user is told the reply was not posted and can retry it

### Requirement: Unaddressed counts describe work left for the user

Unaddressed pull request comment counts SHALL count only thread roots that are unaddressed and authored by someone other than the signed-in user. Replies SHALL NOT be counted on their own. The counts behind pull request badges, per-task pull request status, and project attention SHALL agree on this rule.

When the signed-in user's GitHub identity is unknown, the counts SHALL fall back to counting every unaddressed thread root rather than reporting zero.

#### Scenario: The user's own comment

- **WHEN** a pull request holds an unaddressed comment authored by the signed-in user
- **THEN** it does not count towards that pull request's unaddressed comment count
- **AND** it does not count towards its project's attention

#### Scenario: Reviewer thread with replies

- **WHEN** a reviewer's unaddressed comment has three replies from the reviewer
- **THEN** the thread contributes one to the unaddressed comment count

#### Scenario: Counts agree across surfaces

- **WHEN** the same pull request is shown on its badge, in its task's pull request status, and in its project's attention
- **THEN** all three report the same unaddressed comment count

#### Scenario: Signed-in identity unknown

- **WHEN** the signed-in GitHub identity is not yet known
- **THEN** every unaddressed thread root counts

### Requirement: The comment list shows threads by their root

The review panel's comment list SHALL list thread roots and SHALL NOT list replies as separate entries. Filtering the list to unaddressed comments SHALL apply the same rule the unaddressed counts use, so the list and the counts agree.

#### Scenario: Thread with replies in the list

- **WHEN** the user opens the comment list for a pull request whose reviewer comment has two replies
- **THEN** the list shows one entry for that thread
- **AND** the replies are not listed beside it

#### Scenario: List agrees with the count

- **WHEN** the comment list is filtered to unaddressed comments
- **THEN** the number of entries matches the task's unaddressed comment count
