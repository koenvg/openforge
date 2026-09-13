## Context

See proposal.md for motivation and specs/sdk-icon-button-tooltips/spec.md for the behavior contract.

`packages/plugin-sdk/src/ui/Tooltip.svelte` already uses Bits UI, portals its content, exposes side/alignment/offset, and handles nested Escape dismissal. Its trigger snippet supplies the contents of a styled button, not an existing control. `IconButton.svelte` delegates rendering to `ButtonControl.svelte` and derives disabled, loading, and accessible-label state. Both components already have public SDK registrations and tests.

This design is needed because trigger composition, button event ownership, published SDK compatibility, and application-wide adoption cross component boundaries. The active remove-daisyui and add-ui-storybooks changes also touch shared UI concerns.
### Integration inspection

- `ButtonControl.svelte` already forwards native attributes to its single button and owns both `onclick` and `onClick` dispatch. The private tooltip composition must preserve both callbacks and supply trigger attributes to that button; no second button or layout wrapper is needed.
- `Tooltip.test.ts` covers externally controlled opening without synthetic callbacks, portaled descriptions, keyboard focus and Escape, disabled triggers, menu-item roles, and preservation of existing description IDs. These remain compatibility checks.
- `IconButton.test.ts` covers native button identity, action dispatch, and loading labels/busy state. New behavior should be tested through the same public component rather than the private composition helper.
- `src/publicUiExports.mjs` already registers both components. `src/publicUiDeclarationContract.test.ts` and `scripts/public-ui-declaration-contract.mjs` reject leaked Bits UI types in public props, so the new public positioning props must use SDK-owned types.
- The remove-daisyui design explicitly reuses IconButton and validates packed SDK rendering. This work must preserve its existing direct-token control styling rather than repeat that migration.
- The add-ui-storybooks design uses separate page/component catalogs and requires coverage for new visual modules or explicit non-visual exclusions. Existing SDK action stories live in `storybook/stories/components/sdk/Actions.svelte` and `Actions.stories.ts`; tooltip changes should extend the current catalogs.


## Goals / Non-Goals

Goals:
- Keep one implementation of tooltip interaction, positioning, and presentation inside the SDK.
- Preserve one actual button, its DOM attributes, event semantics, focus behavior, and layout.
- Make tooltip configuration additive to the existing IconButton API.

Non-goals:
- No new animation package, positioning engine, or app-global tooltip service.
- No rich help content, interactive popovers, or generic arbitrary-control trigger API. The user approved opt-in shared tooltips on SDK Button specifically to preserve mixed text/icon controls.
- No unrelated button styling, theme, menu, or backend refactoring.

## Decisions

### Share tooltip composition without changing the standalone trigger contract

Extract a private SDK tooltip composition component used by the existing public Tooltip and IconButton. It owns Bits UI provider/root/portal/content, shared styling, and motion. Its internal trigger snippet supplies the Bits UI trigger attributes and handlers to the existing control rather than rendering another button.

Keep the public Tooltip's existing trigger snippet and props intact through an adapter. IconButton composes its ButtonControl through the private component. If ButtonControl needs an additive internal composition hook, keep that hook private and preserve ordinary Button consumers. Explicitly merge handlers and description IDs rather than letting attribute spread order discard either side. Existing ButtonControl remains the authority for action dispatch and disabled/loading behavior.

Alternative rejected: wrapping IconButton in the current Tooltip nests buttons. A separate hand-written hover implementation would duplicate dismissal, accessibility, and collision behavior. A breaking replacement of the public trigger API is unnecessary.

### Use a small additive IconButton API

Proposed public props:
- `tooltip?: boolean`, default true.
- `tooltipSide?: 'top' | 'right' | 'bottom' | 'left'`, default top.
- `tooltipAlign?: 'start' | 'center' | 'end'`, default center.
- `tooltipSideOffset?: number`, default 6 pixels.

The user also approved these configuration props on SDK Button, with `tooltip=false` by default. An opted-in Button uses its effective `aria-label`; a missing or empty label leaves tooltip behavior disabled. Keep its text-control styling and native button identity unchanged when tooltip configuration or visible content changes. This covers VoiceInput and responsive toolbar controls without replacing the focused control.

Text comes only from the effective accessible label. There is no separate rich content or longer-help prop. Consumers keep full control of that label. Preserve useful existing title information, such as shortcuts, in the label during migration.

Suppress the native `title` attribute while automatic tooltips are enabled to avoid duplicate bubbles. With `tooltip={false}`, retain normal attribute forwarding, including an explicitly supplied title. This is an intentional presentation change, not removal of the existing HTML attribute API.

Alternative rejected: requiring every caller to wrap its icon button or explicitly copy its label into tooltip content would miss existing consumers and let labels drift.

### Preserve native availability behavior

Do not introduce a focusable wrapper for disabled buttons. Automatic tooltips are disabled while the button is disabled or loading. Close an open tooltip when availability changes, and cancel pending opens on removal. Update content reactively when the effective label changes.

Use the existing short 300 ms pointer delay as the initial default, with prompt keyboard-focus opening. Support hovering tooltip content through the existing library behavior. Escape dismisses the tooltip before its containing overlay. Clicking, keyboard activation, and touch preserve action semantics and dismiss tooltip presentation. Do not reopen solely because focus remains after an Escape dismissal or activation; a new qualifying interaction can reopen it.

Alternative rejected: hoverable disabled wrappers would alter layout and tab behavior and expand this change into explaining disabled actions, which the user excluded.

### Treat configured placement as a preference

Reuse Bits UI collision handling and portal behavior. Configure viewport padding and constrain content width to the available viewport, while keeping the current 20rem preferred maximum. Verify placement in scrollers, overflow-hidden parents, menus, dialogs, and near each window edge. The actual placement controls motion direction and transform origin.

Alternative rejected: forcing placement when insufficient space exists would hide labels. Hand-written absolute positioning would duplicate the existing library and fail in clipped containers.

### Animate the inner content, not the positioning wrapper

Use CSS keyframes on tooltip content driven by open/closed state. Leave positioning transforms on the outer wrapper untouched. Initial tuning target: approximately 200 ms entrance, scale 0.96 to 1.02 to 1, a roughly 3px slide from the trigger with a small positional overshoot, and an approximately 100 ms opacity-only exit. Use the rendered side to choose direction. Ensure the library's presence lifecycle retains content for the exit and rapid reopen does not leave duplicate or stranded content.

These are tuning values, not new public configuration. Reduced motion removes translation, scaling, and overshoot; prefer immediate visibility changes. Keep existing SDK theme tokens for presentation.

The reference is https://www.typeui.sh/ui-animations/tooltips, specifically Overshoot. The page could not be fetched during exploration, so these values are an interpretation, not a verified reproduction. Review the reference and the component story during implementation before final visual approval.

Alternative rejected: adding a spring animation dependency for one small effect adds SDK weight without a demonstrated need.

## Risks / Trade-offs

- Event composition could double-dispatch or drop cancellation. Mitigation: test click, keyboard, consumer handlers, disabled/loading states, and the existing ButtonControl contract before migrating callers.
- Portal layering or Escape propagation could interfere with menus and dialogs. Mitigation: extend existing ContextMenu tooltip coverage and add browser checks in both overlay types.
- Automatic tooltips can expose duplicate native titles or custom wrappers. Mitigation: audit host and built-in plugin consumers, remove duplicates, and record justified opt-outs.
- Buttons rendered in large lists add tooltip state. Mitigation: mount content only while needed and check rapid hover/unmount behavior in a representative dense toolbar or list.
- Animation can compete with positioning or exit unmounting. Mitigation: keep transforms on separate elements and verify actual browser lifecycle, collision flips, and reduced motion.
- Shared UI changes can overlap other active changes. Mitigation: reconcile their current artifacts and touched files at implementation start rather than incorporating unrelated work.

## Migration Plan

1. Add failing SDK behavior tests, then implement the private composition and additive IconButton props while keeping standalone Tooltip tests passing.
2. Update published declarations/contracts and stories before changing application callers.
3. Inventory icon-only action buttons in host and built-in plugin interfaces. Existing SDK consumers inherit defaults. Migrate raw action buttons where applicable, remove duplicate tooltip presentation, and apply explicit placement where layouts require it. Document exceptions without rewriting unrelated controls.
4. Run full affected-subsystem tests and static checks plus published SDK contract checks. Validate placement, focus, layering, animation, and reduced motion in a browser.
5. Roll back by reverting the composition, IconButton integration, and associated caller migrations together. No data migration is involved.

## Open Questions

- Exact overshoot amplitude and timing can be tuned against the TypeUI reference and component stories without changing the API or behavior contract.
