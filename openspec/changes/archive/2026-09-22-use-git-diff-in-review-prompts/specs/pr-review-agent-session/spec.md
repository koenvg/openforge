## MODIFIED Requirements

### Requirement: Walkthrough instructions use the scoped checkout for change content
Walkthrough generation SHALL direct the review agent to inspect the complete pull request change from its host-owned scoped checkout with Git. The generated instructions MUST NOT embed patch bodies. They SHALL identify the pull request's actual base ref and direct the agent to compare that ref with `HEAD` from their merge base, inspect the changed-file summary and full diff, and use repository history when needed. The instructions MUST NOT treat the latest commit alone as the pull request change.

The generated instructions SHALL keep review content separate from walkthrough submission coordinates. They SHALL omit the Changed Files review section and include a compact submission-coordinate block containing only every authoritative changed-file path and the valid zero-based hunk indexes for that file. The agent SHALL use Git to understand the change and the coordinate block only to submit steps that match the host's validation snapshot.

All other walkthrough context and command contracts SHALL remain available, including the pull request description, resolved Jira ticket, configured guidance, existing review comments, generation attempt id, walkthrough-step command, and Review Thread address.

#### Scenario: Agent inspects the complete pull request diff
- **WHEN** walkthrough generation starts for a pull request targeting `main`
- **THEN** the generated instructions direct the agent to inspect the changed-file summary and full diff from the merge base of `main` and `HEAD`
- **AND** the instructions make clear that reviewing only the latest commit is insufficient

#### Scenario: Pull request targets another base branch
- **WHEN** walkthrough generation starts for a pull request targeting `release/2026.09`
- **THEN** the generated instructions identify `release/2026.09` as the base ref used for Git comparison
- **AND** they do not hard-code `main`

#### Scenario: Large patch remains outside the instructions
- **WHEN** a pull request file contains a large patch and walkthrough generation starts in its scoped checkout
- **THEN** the generated instructions identify the base ref and submission coordinates without containing the patch body
- **AND** the agent is directed to inspect the change with Git in the checkout

#### Scenario: Manifest preserves submission coordinates
- **WHEN** the host captures a changed file with multiple patch hunks
- **THEN** the generated instructions list the exact changed-file path and every valid zero-based hunk index for that file beside the walkthrough submission contract
- **AND** the coordinate block omits file status, previous filename, addition count, and deletion count
- **AND** the existing walkthrough-step command and validation contract remain unchanged

#### Scenario: Existing review context remains available
- **WHEN** walkthrough generation has pull request context, configured guidance, existing comments, or a resolved Jira ticket
- **THEN** the generated instructions retain that context while omitting patch bodies
