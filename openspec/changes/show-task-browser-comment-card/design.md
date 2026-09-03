## Context

See `proposal.md` for motivation and `specs/task-browser-visual-feedback/spec.md` for required behavior.

The Task Browser page is presented through a native Electron `WebContentsView` above the OpenForge renderer. Renderer-owned Svelte content cannot reliably float over that native view. The Electron host already injects a visual-feedback layer into the live page for region selection, comment composition, numbered markers, navigation restoration, and capture exclusion.

The Task Browser plugin owns the durable draft, background capture artifacts, edits, deletion, undo, discard, and Agent follow-up delivery. The host receives synchronized annotations for rendering but does not own the review model. OpenForge's configured light or dark theme lives in renderer state, so the plugin must pass the current appearance across the Browser Surface boundary.

## Goals / Non-Goals

**Goals:**

- Render current-URL comments in the same host-owned page layer as their numbered markers.
- Match the configured OpenForge light or dark appearance and update when it changes.
- Let a trusted user request annotation deletion from the card while the plugin remains authoritative.
- Keep the card readable, bounded, collapsible, and keyboard accessible across arbitrary HTTP(S) pages.
- Remove the complete card during selection and evidence capture.

**Non-Goals:**

- Moving draft persistence, capture ownership, or review state into Electron.
- Adding in-card send, edit, undo, recovery, or cross-page review actions.
- Replacing the plugin's full review UI.
- Showing annotations from URLs other than the exact visible URL.
- Persisting disclosure state across navigation, surface recreation, or app restart.

## Decisions

### Render the card inside the host-owned annotation layer

The annotation script will create the lower-right card inside the existing live-page annotation root. This places the card above arbitrary page content while retaining region selection as the higher interaction layer.

A renderer-owned floating card was rejected because the native browser view covers renderer DOM. A docked Svelte sidebar was rejected because it changes browser layout and does not match the requested in-page placement. A second native view would add lifecycle complexity without improving the card.

### Derive presentation from current-URL synchronization

The card will use the same current-page annotation collection as numbered outlines. It will sort by annotation number, derive count text, and remove itself when the collection is empty. The controller will continue grouping annotations by exact URL, so navigation teardown and destination refresh cannot leak comments across URLs.

The Browser Surface visual-feedback synchronization method will accept an optional presentation object containing the configured `light` or `dark` appearance. Existing callers remain compatible. The Task Browser plugin will derive the configured appearance from renderer theme state, observe later theme changes, and resynchronize without changing annotation data. The native controller will retain the latest appearance for navigation refreshes.

Maintaining a separate Electron theme preference was rejected because it would duplicate renderer configuration and could drift from what the user sees elsewhere in OpenForge.

### Keep disclosure state local to the rendered URL

A new card will start expanded. Same-URL synchronization will read the existing disclosure state before rebuilding the card. A native disclosure button will switch between the expanded list and compact count control. Navigation removes the annotation root, so returning to an annotated URL starts expanded.

### Forward trusted deletion requests to the owning plugin

The Browser Surface SDK will add a typed visual-feedback action event alongside state-change events. The initial action is `{ type: 'delete-annotation', annotationNumber }`. Electron main will validate the surface generation, exact current URL, and synchronized annotation number before forwarding the event through the existing window-scoped plugin event route.

The injected delete control will emit an action only for trusted user activation. Programmatic page events are ignored. The renderer controller will filter events by surface identity and generation, then notify the owning plugin. The Task Browser plugin will route the request through the same deletion, persistence, capture cleanup, undo, error recovery, and live synchronization path used by its review controls.

Electron will not remove a marker or card row optimistically. The row disappears only after the plugin updates its authoritative draft and calls visual-feedback synchronization. This avoids host and plugin state diverging when persistence fails.

Direct host-side deletion was rejected because the host cannot safely update plugin draft storage, captures, undo history, or Agent report state. Encoding actions through page console messages was rejected because page content could forge them.

### Contain card presentation and interaction

The card will use semantic DOM, a labelled region, an ordered list, and native disclosure and delete buttons. Inline host-owned styles will reset inherited page styling, use one of two tested OpenForge appearance palettes, and constrain the card to viewport gutters. The list will scroll locally when needed.

The annotation root will remain pointer-transparent outside host UI. The card will accept input within its bounds, contain host UI events, show visible focus states, and unregister persistent event shields during rebuild or teardown.

### Remove the complete card during selection and capture

Region selection will set the card to `display: none` rather than relying on inherited `visibility`. Descendants use style resets, so inherited visibility can leave row content visible after the container disappears. Removing the card from layout also removes it from hit testing and the accessibility tree. Selection cleanup restores its prior display and disclosure state.

Visible-viewport capture will continue hiding the complete annotation root before capture and restoring it afterward. Because the card remains a child of that root, markers and comments stay out of evidence without a second capture mechanism.

### Verify behavior at public boundaries

Page-script tests will execute generated overlay scripts in jsdom and cover both appearance palettes, ordered comments, disclosure, trusted deletion controls, untrusted-event rejection, complete selection concealment, bounded layout, and cleanup.

SDK contract tests will cover the optional presentation input and typed action subscription. Electron controller, manager, boot adapter, and renderer bridge tests will cover surface generation and URL validation plus event routing. Task Browser plugin tests will prove that in-card requests use the existing deletion path, persist draft changes, clean captures, retain failures, and resynchronize markers.

## Risks / Trade-offs

- [Page content forges destructive actions] -> Require trusted user activation and validate current surface generation, URL, and annotation identity before forwarding.
- [Theme state drifts between renderer and native page] -> Send configured appearance with every synchronization and resynchronize on theme changes.
- [Deletion leaves host and plugin state inconsistent] -> Keep the row until authoritative plugin synchronization succeeds; never mutate durable state in Electron.
- [Arbitrary site CSS changes the host card] -> Reset inherited styles and keep required layout and palette values inline.
- [Persistent page event shields leak] -> Register them once per annotation root and remove them during rebuild, clearing, and navigation teardown.
- [The card obscures lower-right page content] -> Bound dimensions, keep viewport gutters, and provide immediate collapse.
- [Long comments dominate the viewport] -> Wrap text and constrain the list to a local scroll area.

## Migration Plan

The SDK changes are additive: visual-feedback presentation is optional and the new action subscription does not affect existing Browser Surface callers. Ship the SDK runtime, renderer bridge, Electron host, and built-in Task Browser plugin together. Rollback removes the action subscription and appearance input while retaining the existing marker and review behavior; no persisted data migration is required.
