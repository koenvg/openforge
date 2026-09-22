## Why

The pull request Agent tab currently surrounds a failed terminal mount with status copy, a Stop action, and a separate message form. Reviewers want the same direct interaction as the Task Agent tab: open the tab, see the live agent TTY, and type into it.

## What Changes

- Start an interactive, read-only review agent automatically when the reviewer opens the Agent tab and no session exists for the current pull request head.
- Make the Agent tab body a terminal-only view using the same visual treatment and direct keyboard interaction as the Task Agent tab.
- Keep a Generate walkthrough action outside the terminal. It sends the walkthrough prompt into the already-running session instead of creating the session and prompt together.
- Remove the Stop action, session status header, explanatory empty states, and separate follow-up form from the Agent tab.
- Repair the scoped terminal mount so the live and retained TTY renders instead of reporting a structured-clone failure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pr-review-agent-session`: Change session startup, Agent-tab presentation, walkthrough prompt delivery, and reviewer input behavior.

## Impact

- GitHub Sync pull request detail header and Agent tab.
- Pull request scoped-session startup and walkthrough-generation coordination.
- Frontend scoped-session terminal mounting and its integration with the shared Terminal Runtime.
- Focused GitHub Sync UI, controller, walkthrough lifecycle, and terminal-mount tests.
