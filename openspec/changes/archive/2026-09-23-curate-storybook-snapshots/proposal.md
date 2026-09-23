## Why

The visual manifest contains 502 cases across 376 stories, and recent successful Storybook CI runs took 28.5–29.2 minutes. Repeated themes and business states increase capture and review cost without always covering a distinct visual risk.

## What Changes

- Keep all existing development stories, but curate the canonical snapshot manifest around distinct layouts, interactions, renderers, and known regressions.
- Target approximately 200–250 cases, subject to a reviewed coverage inventory rather than an arbitrary hard cap.
- Consolidate repeated status variants into small, readable gallery stories, with both themes represented.
- Retain narrow/overflow layouts, focus and overlays, media and terminal rendering, and documented raster regressions.
- Record why each removed baseline is redundant and which retained screenshot or behavioral assertion covers its risk.
- Preserve baseline comparison and independently initialized repeatability capture for every declared case. Do not weaken pixel tolerances or readiness checks.

## Capabilities

### New Capabilities

- `storybook-snapshot-selection`: Risk-based selection and reviewable coverage accounting for canonical screenshot cases.

### Modified Capabilities

None. The complete-matrix guarantee in `storybook-visual-execution` continues to apply to every declared case.

## Impact

Changes will affect `storybook/visual-manifest.json`, reviewed files in `storybook/baselines`, gallery stories, relevant behavioral tests, and `docs/storybook-visuals.md`. No application behavior, dependency changes, or CI scheduling changes are included. The separate `parallelize-ci-checks` proposal can be implemented independently and must consume whichever manifest is current.
