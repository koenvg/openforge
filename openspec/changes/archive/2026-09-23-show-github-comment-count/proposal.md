## Why

The Self Review panel exposes the GitHub comment count only through the tab's accessible name, so sighted users cannot tell whether comments are waiting without opening the tab. A visible count on the existing comment toggle makes that state available at a glance.

## What Changes

- Add a visible numeric badge to the GitHub comments tab icon when at least one GitHub review thread exists.
- Keep the count aligned with the existing tab label by counting review thread roots, including addressed threads, without counting replies as separate items.
- Update the badge reactively when GitHub comments arrive, disappear, or refresh without changing the selected tab or panel visibility.
- Preserve the tab's count-aware accessible name and omit the badge when the count is zero.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `self-review-workspace`: Make the existing GitHub comment count visible on the icon-only comments tab and define its count and zero-state behavior.

## Impact

- Affects the Self Review side-panel tab presentation and its focused renderer tests.
- Reuses the current GitHub review-thread collection and existing badge styling; no backend, IPC, persistence, or dependency changes are expected.
