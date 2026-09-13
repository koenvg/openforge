# Partial implementation evidence

Implementation is not complete: 10/18 tasks are checked. Public test seams remain IconButton/Tooltip, published SDK imports, and browser-visible behavior.

## Delivered at this checkpoint

- Private TooltipControl shares trigger composition, portal positioning, dismissal, motion, and theme tokens without nesting buttons or adding layout wrappers.
- IconButton uses its effective accessible label by default, supports opt-out and side/alignment/offset, suppresses duplicate native titles, and disables tooltip interaction while disabled/loading.
- Standalone Tooltip retains its existing public trigger and controlled-state contract, including programmatic focus behavior.
- Automatic tooltips ignore non-keyboard focus to prevent first-touch activation from leaving an open bubble. Browser tests verify touch, Enter, Space, retained focus, and action counts.
- Tab closes an open tooltip synchronously during capture so Bits UI releases its non-trapping focus scope before the containing dialog handles Tab. A full SDK test run exposed this regression; a real Chromium Shift+Tab/Tab test reproduced it before the fix. Both native browser and existing Modal focus-loop tests now pass.
- Shared behavior adopted by collapsed PluginSidebarLink, AnchoredMenu's icon-only triggerButton branch (including SplitButton), and Mermaid preview zoom/close buttons. Native geometry and the preview close-button focus reference are preserved; zoom labels retain shortcuts.
- Private runtime asset packaging and packed-consumer fixtures include TooltipControl and additive IconButton configuration. README documents behavior and positioning.

## Latest validation

All commands below passed against the current SDK source, after the touch and dialog focus fixes:

| Command | Result / evidence |
| --- | --- |
| `pnpm --filter @openforge-app/plugin-sdk test` | 72 files passed; 591 tests passed and 3 expected failures. `/tmp/KVG-5005-sdk-tests.log` |
| `pnpm --filter @openforge-app/plugin-sdk build` | Passed, including entrypoint validation and copied runtime assets. `/tmp/KVG-5005-sdk-build.log` |
| `pnpm --filter @openforge-app/plugin-sdk check:entrypoints` | Passed explicitly after the build. |
| `pnpm --filter @openforge-app/plugin-sdk check:contract` | Passed, including clean npm/Bun packed consumers and mounted rendering contracts. `/tmp/KVG-5005-sdk-contract.log` |
| `pnpm exec tsc --noEmit` | Passed. `/tmp/KVG-5005-types.log` |
| `git diff --check` | Passed before final documentation updates. |

The SDK total includes 24 Tooltip browser tests: four preferred sides, alignment/gap, edge collision and collision-flipped entry direction, overflow clipping and wrapping, overshoot/settle, short exit and rapid reopen, hover delay and hoverable content, Enter/Space/touch, nested Escape, dialog Tab wrapping, reduced motion, and all four built-in themes' portaled colors.

Focused ContextMenu compatibility tests also passed. Mermaid preview has six passing tests; PluginSidebarLink has six; SplitButton and AnchoredMenu passed their focused suites and the full SDK run.

The earlier publication timeout is resolved. The first full SDK run's Modal Tab-loop failure is also resolved; it was caused by tooltip integration, not waived as an unrelated test failure.

## Test environment notes

- Hover delay uses a paused Playwright clock before pointer entry; simply installing a running clock introduces elapsed wall time into the 299 ms assertion.
- jsdom cannot reliably model `:focus-visible` after synthetic pointer input. IconButton unit tests simulate that browser selector boundary; real keyboard/touch modality is tested in Chromium.
- The earlier synthetic parent-Escape wrapper was removed in favor of the real Modal browser test, which verifies first Escape dismisses only the tooltip and second Escape dismisses the dialog.
- Mermaid's ResizeObserver test fixture now selects the observer registered for the preview viewport, not whichever observer was created last; tooltips legitimately add another observer.

## Reference and visual status

The TypeUI reference is now accessible through Chromium. Its Overshoot card was opened and captured at `/tmp/KVG-5005-typeui-overshoot.png`; the screenshot was inspected. The reference-access blocker is resolved, but a motion comparison with the component stories and final visual approval remain pending. The implemented motion remains the approved tuning target, not a claimed pixel-for-pixel reproduction.

## Decision and remaining work

The user approved opt-in SDK Button tooltips. Implemented `tooltip=false` by default with the same placement props, using the effective aria-label and retaining the native button across toggles. VoiceInput's icon-only idle state and toolbar Run app, VS Code, and details actions opt in. Ordinary Button native submit defaults and explicit type forwarding are preserved. A public Button test first reproduced missing opt-in behavior and then verifies focus/element identity and opt-out closure.

After this approved extension, full SDK validation passed again: 72 files, 592 passing tests plus 3 expected failures; SDK build/entrypoints, packed npm/Bun contract, root TypeScript, and root lint passed. Logs: `/tmp/KVG-5005-button-sdk-tests.log`, `button-sdk-build.log`, `button-sdk-contract.log`, `button-types.log`, and `button-lint.log` under the same `/tmp/KVG-5005-` prefix. Focused VoiceInput and toolbar suites passed 29 tests (`/tmp/KVG-5005-mixed-consumers.log`). Broader renderer/plugin and Storybook checks are still pending.

Still pending: complete consumer inventory, meaningful native-title information migration into labels, host/plugin adoption and placement, component stories and coverage, Storybook integration/visual review, complete affected renderer/PR-review/terminal/plugin checks, and final reconciliation. The current SDK validation must be rerun if subsequent SDK/API edits affect it. No skipped broader validation is claimed to have passed.
