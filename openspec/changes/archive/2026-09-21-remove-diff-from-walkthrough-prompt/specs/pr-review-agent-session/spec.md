## ADDED Requirements

### Requirement: Walkthrough instructions use the scoped checkout for change content
Walkthrough generation SHALL direct the review agent to inspect the pull request change from its host-owned scoped checkout. The generated instructions MUST NOT embed patch bodies. They SHALL identify the pull request base ref and include a compact manifest containing every authoritative changed-file path and the valid zero-based hunk indexes for that file, so the agent can submit steps that match the host's validation snapshot.

All other walkthrough context and command contracts SHALL remain available, including the pull request description, resolved Jira ticket, configured guidance, existing review comments, generation attempt id, walkthrough-step command, and Review Thread address.

#### Scenario: Large patch remains outside the instructions
- **WHEN** a pull request file contains a large patch and walkthrough generation starts in its scoped checkout
- **THEN** the generated instructions identify the base ref and changed file without containing the patch body
- **AND** the agent is directed to inspect the change with repository tools in the checkout

#### Scenario: Manifest preserves submission coordinates
- **WHEN** the host captures a changed file with multiple patch hunks
- **THEN** the generated instructions list the exact changed-file path and every valid zero-based hunk index for that file
- **AND** the existing walkthrough-step command and validation contract remain unchanged

#### Scenario: Existing review context remains available
- **WHEN** walkthrough generation has pull request context, configured guidance, existing comments, or a resolved Jira ticket
- **THEN** the generated instructions retain that context while omitting patch bodies
