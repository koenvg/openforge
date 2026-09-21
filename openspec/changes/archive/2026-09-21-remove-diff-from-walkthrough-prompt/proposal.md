## Why

Walkthrough generation copies every pull request patch into the agent's instructions even though the agent already runs in a checkout of that pull request head. Large diffs make the first turn needlessly expensive and can exhaust the provider's input limit before review begins.

## What Changes

- Stop embedding patch bodies in walkthrough instructions.
- Tell the review agent to inspect the change from its scoped workspace.
- Keep a compact changed-file manifest with the exact paths and valid hunk indexes required by walkthrough-step validation.
- Preserve the existing pull request description, Jira ticket, review guidance, existing comments, CLI submission contract, and review-thread address.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pr-review-agent-session`: Walkthrough generation will use the scoped checkout for diff content while retaining only bounded submission metadata in the prompt.

## Impact

- GitHub Sync walkthrough prompt compilation and its prompt template.
- Focused prompt and backend tests for generated walkthrough instructions.
- No API, storage, dependency, or user-interface changes.
