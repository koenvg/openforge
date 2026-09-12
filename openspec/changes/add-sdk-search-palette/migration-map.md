# Migration map

- `CommandPalette.svelte`, `ActionPalette.svelte`, and `ProjectSwitcherModal.svelte` now consume the SDK search palette and retain domain state and callbacks.
- `FileQuickOpen.svelte` consumes all four old palette controls. `PromptInput.svelte` consumes the old listbox for inline completion. The owner approved retaining those controls and tests unchanged. Their later migration and removal are tracked in KVG-4988.
- `storybook/shared/frames/PaletteControls.svelte` demonstrates the SDK component. Preserve separate legacy-control stories and coverage ownership until KVG-4988 migrates their consumers.
- SDK public UI exports are canonical in `packages/plugin-sdk/src/publicUiExports.mjs` and checked against package.json and root TypeScript paths. All three registrations include SearchPalette. Packed npm and Bun consumer checks compile the new palette.
- The shared navigation helper now lives in the SDK and is exported from its frontend entrypoint. The old app path is a re-export. Validate every remaining consumer after restoring the legacy controls.
- Existing SDK Modal owns portal/focus containment. The new palette styles its actual panel, and browser checks exercise the real theme registry and stylesheet loader; only plugin CSS asset delivery is intercepted.
- Other active OpenSpec changes are planning context only. This task does not depend on applying their artifacts.

## Baseline

`pnpm exec vitest run --maxWorkers=1 src/components/shell/CommandPaletteComponent.test.ts src/components/shell/ActionPaletteComponent.test.ts src/components/project/ProjectSwitcherModal.test.ts src/components/shell/PaletteModal.test.ts src/lib/useListNavigation.svelte.test.ts`: 5 files, 44 tests passed. The initial parallel run timed out during cold transforms and produced duplicate-element fallout; serialized execution passed without source changes. Keep focused checks serialized.
