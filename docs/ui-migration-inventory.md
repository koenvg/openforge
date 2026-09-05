# UI migration inventory

Run `pnpm check:ui-migration`. It also runs through `pnpm lint`, and its seeded tests run through `pnpm test`:

```sh
pnpm exec vitest run scripts/check-ui-migration-inventory.test.mjs
```

This enforces the completed migration clusters 7.2 through 7.10 in `openspec/changes/add-angular-extensible-theming`. It is a static source inventory, not a replacement for component behavior tests or visual checks.

## Scope

`scripts/ui-migration-scope.mjs` owns the bounded source roots. Discovery is recursive, so adding a file inside a covered area does not require updating a file manifest.

- Presentation checks cover every production component and stylesheet under `src/components`, `packages/pr-review-ui/src`, `packages/terminal-runtime/src`, and the five built-in plugins: file-viewer, GitHub sync, task-browser, task-schedules, and terminal.
- The previously covered SDK `PluginSidebarLink.svelte` stays covered. Other SDK controls own their implementation and are not caller-migration targets.
- Import and obsolete-implementation checks additionally cover all production source under `src` and `packages/plugin-sdk/src`.
- JavaScript, TypeScript, declaration files, Svelte components, and CSS are included. Test/spec files, test wrappers/harnesses, and named fixture/testing/visual directories are excluded. Missing roots and parse failures fail the command.
- The hello-world demo was deleted in commit `8d10247b`; there is no remaining demo UI to migrate. The website, mobile app, Rust code, dependencies, and generated bundles are outside this migration scope.

## Rules

1. Reject direct daisyUI control families `btn`, `input`, `select`, `textarea`, `checkbox`, `toggle`, `badge`, `card`, `tab`/`tabs`, `join`, `modal`, `dropdown`, `tooltip`, `menu`, and `collapse`, including their modifiers. Tailwind's `select-none`, `select-text`, `select-all`, and `select-auto` are text-selection utilities, not daisyUI selects.
2. Reject restored renderer-private shared controls and imports of them: `ActionDropdown`, `AnchoredMenu`, `Card`, `CollapsibleInfoSection`, `CopyButton`, `HoverTooltip`, `Modal`, `PrStatusChip`, `ResizablePanel`, and `SearchableSelect` under `shared/ui`. Active domain-specific components are not obsolete merely because they contain native elements.
3. Reject literal `bits-ui` imports and subpath imports outside `packages/plugin-sdk/src/ui`. This includes imports, re-exports, dynamic imports, `require`, TypeScript import types, and TypeScript `import = require(...)` assignments. SDK consumers continue to use the existing public SDK interfaces.
4. Reject fixed radius and size utilities, including state/responsive variants, decimal and named sizes (`h-px`, `max-w-sm`), `size-*`, arbitrary sizes, and edge-specific radii. Inspect CSS lengths and percentages for width, height, logical size, and radius declarations in inline styles, style directives, and scoped or separate CSS. Direct `--of-*` token utilities and declarations remain valid.

The Svelte parser handles quoted classes, class directives, arrays, object syntax, conditionals, templates, locally declared values (including fragment-scoped `{@const}` bindings), and class-forwarding properties such as `triggerClass`, `boxClass`, and `listClass`. The check does not execute JavaScript, trace arbitrary imported helper implementations, or evaluate runtime-computed class names. Keep covered control styling in SDK components rather than concealing it behind runtime string generation.

## Exceptions

`scripts/ui-migration-allowlist.json` is reviewed policy, not an automatically refreshed baseline. Each entry binds a reason and occurrence count to an exact file, element or CSS selector, source context, and set of geometry tokens. The checker rejects extra occurrences, stale entries, and policy paths whose files were deleted or renamed. Exceptions cannot suppress control classes, forbidden imports, or obsolete implementations.

Allowed geometry is limited to:

- Flex/grid children that must shrink, scroll, or wrap. For example, `min-w-0` is layout, not a fixed input width.
- Pane and table widths, header/divider alignment, palette and media viewport bounds, and the expanded settings editor viewport.
- Icon artwork, author avatars, domain-status glyphs, chart dimensions, and keyboard-shortcut notation. These do not set control hit areas.
- Square shared edges between connected diff rows and inspector sections.

Control heights and ordinary corners belong to theme tokens. A new standard control, input, or button is not a layout exception. Prefer removing the override or using the appropriate SDK component before adding policy entries. When layout legitimately changes, update only the affected exact contexts and explain why they remain feature-owned.

## Failure proofs

The suite seeds every rule through source diagnostics and through the command against a temporary source tree. It also checks new-file discovery, SDK implementation isolation, ambient type imports, class forwarding, style declarations, non-code import text, and exception boundaries. No seeded violations remain in production files.

The command accepts `--root <directory>` for isolated fixtures and loads that root's own `scripts/ui-migration-allowlist.json`; fixture trees must supply this file, even for an empty policy. Normal development and CI use the repository root without this flag.
