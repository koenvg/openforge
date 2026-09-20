## Context

See proposal.md for motivation. The current manifest has 242 page cases and 260 component cases, including 301 light and 201 dark cases. Task-list items alone account for 52 cases covering 26 states in two themes. File Viewer has 25 cases, Self Review 22, and Task Detail 20. These counts are discovery evidence, not permanent quotas.

The existing visual execution spec requires baseline and repeatability checks for every declared identity. `docs/storybook-visuals.md` documents past modal, terminal, cursor, and focused-input failures. The runner also relies on explicit representative identities for its fault probes.

## Goals / Non-Goals

Goals: reduce redundant captures and review burden while retaining a defensible visual risk inventory. Make future baseline additions justify their cost.

Non-goals: delete development stories, replace visual assertions with behavioral assertions where appearance matters, alter production components just to simplify snapshots, change capture tolerances, remove repeatability, or change CI topology.

## Decisions

### Maintain an explicit coverage inventory

Add a reviewable inventory alongside the visual documentation, mapping current case identities to retained cases, replacement galleries, or behavioral test assertions. Record the specific risk and rationale for each removal. Include known regression and runner-probe identities as protected entries. Validate references against the manifest and story catalog. A count-only deletion would be faster but cannot establish what protection remains.

The initial target is about 200–250 cases. Coverage takes priority; report any justified deviation instead of silently deleting unique coverage to hit the number.

### Consolidate repeated appearances, not different layouts

Start with task-list status variants. Add compact gallery stories using existing components and fixtures, with visible labels and fixed, readable spacing. Snapshot those galleries in both themes, retaining individual long-content, selected, and dependency cases when their geometry or interaction differs. Keep the original isolated stories for development.

For pages, retain representative populated, narrow, and overflow layouts and visually distinct interactions. Shared empty/loading/error presentation belongs primarily in component snapshots; retain page-specific arrangements. Keep separate media renderers and terminal states. Do not assume two business states are visually equivalent without inspecting their rendered output.

### Sample themes by rendering risk

Retain both themes for shared controls, galleries, representative pages, and known theme-specific regressions. Most additional state/layout variants need one theme unless they exercise distinct theme-sensitive rendering. Removing every dark case would save work but miss contrast and token regressions.

### Verify behavior independently

For removed cases whose unique value is status-to-label, icon, action availability, or state transitions, identify existing assertions or add focused behavioral tests first. A screenshot of a gallery covers appearance; assertions cover the correct mapping. Avoid building a second exhaustive screenshot matrix inside the galleries.

## Risks / Trade-offs

- Less page-level state coverage: preserve representative integration layouts and explicitly record what is delegated to shared components.
- Oversized galleries obscure diffs or clip content: use several small galleries, inspect every row, and keep interaction/layout cases separate.
- Hidden historic regression coverage: protect cases referenced by stability probes and investigation documents until equivalent evidence is reviewed.
- Concurrent catalog growth: reconcile the inventory against the current manifest at implementation time, not the original count of 502.

## Migration Plan

Capture pre-change timing and identity counts. Create the inventory and test any missing behavior assertions before removing baselines. Add galleries, render them in the pinned container, and review their images. Edit the manifest and explicitly remove only the approved obsolete baseline files. Run full canonical baseline/repeatability validation and compare timing on equivalent hardware.

Keep changes reviewable by family. Roll back a problematic family by restoring its manifest entries and approved images; no production migration is involved. This change is independent of CI sharding and must retain the runner's protected representative cases.
