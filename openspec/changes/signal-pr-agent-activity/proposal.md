## Why

Pull request agents can keep working after reviewers leave the Agent tab, but the tab gives no sign that a turn is active or that a finished response has not been viewed. Reviewers must reopen the terminal to discover whether anything changed.

## What Changes

- Show a compact running indicator on the pull request Agent tab while a provider turn is queued, starting, or actively running.
- Show a separate unread-output indicator when a stopped turn has not been viewed in a ready, visible Agent terminal.
- Preserve unread state across navigation and application restarts for the exact pull request head.
- Allow running and unread indicators to appear together when an older response remains unseen while another turn runs.
- Give each state a distinct shape and accessible tab name, and stop indicator motion when reduced motion is requested.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pr-review-agent-session`: Add running and unread activity signals to the pull request Agent tab, including acknowledgement, persistence, accessibility, and concurrent-state behavior.

## Impact

- GitHub Sync pull request review state, scoped-agent lifecycle observation, Agent terminal attachment, and plugin storage.
- Pull request detail tab rendering and its shared Plugin SDK Tabs component.
- Focused GitHub Sync and Plugin SDK component and controller tests. No backend or public Agent Sessions API change is planned.
