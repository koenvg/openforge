## Context

See proposal.md for motivation and scope. SelfReviewWorkspace currently renders its diff container before SelfReviewSidePanel. The side panel combines both tabs in one SDK ResizablePanel with `side="right"`, a left border, and the storage key `self-review-side-panel`.

A short design records the DOM-order versus visual-order decision, resize orientation, and spec integration sequence before coding. The existing self-review-workspace baseline is in the completed but unarchived share-self-review-side-panel change.

## Goals / Non-Goals

**Goals:** Keep the layout change within the two composing components and reuse existing sizing and state ownership.

**Non-Goals:** No controller lifecycle changes, SDK changes, new layout settings, additional columns, or altered narrow-host policy.

## Decisions

1. Render the existing conditional, task-keyed side-panel block before the diff container. Do not use CSS order or row reversal: DOM order should match visual and keyboard reading order. Keep the diff and repository-preview container intact.
2. Use the existing `side="left"` ResizablePanel behavior and change the panel divider to the right border. The SDK already places the separator on the right and handles pointer and arrow-key resize direction for this side. Do not duplicate resize logic.
3. Retain the persistence key, default/minimum/maximum widths, available-width calculation, bindings, and task key. A new key would unnecessarily discard saved widths. Tab, selection, collapse, and feedback state stay in their existing owners.
4. Keep both tabs together at every supported width. Do not introduce an overlay or automatic project-sidebar collapse. Validate at 900, 1280, 1600, and 1920px viewport widths with 800px height and the project sidebar open, matching the baseline contract.
5. Use a renamed and modified requirement in the same self-review-workspace capability. Sync or archive the predecessor baseline before archiving this delta. Do not edit the predecessor or main specs during this proposal workflow.

## Risks / Trade-offs

- Visual reordering alone could leave keyboard order inconsistent. Mitigation: reorder the rendered blocks and verify focus-file-tree navigation from either tab and the collapsed state.
- Incorrect docking orientation could reverse resize behavior. Mitigation: exercise pointer and keyboard resizing on the panel's right edge.
- A restored wide panel could obscure controls on a narrow host. Mitigation: retain the current width constraints and verify oversized saved widths at the baseline viewport sizes.
- The predecessor's right-hand requirement could overwrite this change if synced later. Mitigation: integrate the predecessor baseline first, then this rename and modification.

## Verification

Use existing SelfReviewView side-panel, workspace, and pane-restoration suites for interaction regressions, plus existing ResizablePanel coverage where relevant. Add behavioral tests before changing behavior when coverage is missing; do not add source-string or CSS-class assertions for styling. Verify actual left/right geometry, divider placement, and both tabs with the repository-approved browser or screenshot workflow in CONTRIBUTING.md and docs/storybook-visuals.md. Run root renderer lint checks. If implementation expands into shared SDK, controller lifecycle, or contract code, widen validation to the full affected subsystem as required by AGENTS.md.

## Migration Plan

No runtime data migration is needed. Preserve the existing width key. Ship the component layout change through the normal app release. Reverting the component changes restores right docking without discarding persisted width. Before spec archival, sync the predecessor capability baseline, then apply this delta.
