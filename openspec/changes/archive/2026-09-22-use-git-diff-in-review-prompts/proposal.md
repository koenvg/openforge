## Why

The review prompt currently presents a generated Changed Files manifest before telling the agent to inspect the checkout. This duplicates information Git already provides and makes the manifest look like review input, even though its only irreplaceable data is the host-owned hunk indexes used for walkthrough submission.

## What Changes

- Remove the `## Changed Files` review section and direct the agent to inspect the complete pull request with Git against the pull request's actual base branch.
- Tell the agent to use merge-base diffing, changed-file summaries, and repository history rather than reviewing only the latest commit or the prompt metadata.
- Keep a compact walkthrough submission-coordinate block containing only authoritative filenames and zero-based hunk indexes.
- Preserve the existing ticket, pull request description, review comments, configurable guidance, command contracts, and rule that patch bodies stay out of the prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pr-review-agent-session`: Separate Git-based change inspection from the host-owned coordinates used to submit validated walkthrough steps.

## Impact

- GitHub Sync's built-in walkthrough and review prompt template and compiler.
- Prompt-generation tests for base-ref diff instructions and submission coordinates.
- No changes to the walkthrough step schema, validation snapshot, storage, CLI commands, or user settings.
