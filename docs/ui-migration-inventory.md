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

## Semantic color migration, KVG-4863

The guard also has a reporting mode. It does not weaken the completed-cluster enforcement above or reject the legacy consumers that later migration tasks still own.

```sh
node scripts/check-ui-migration-inventory.mjs --legacy-inventory > docs/ui-migration-consumers.json
pnpm exec vitest run scripts/check-ui-migration-inventory.test.mjs scripts/semantic-utilities.test.mjs scripts/ui-migration-baseline-measurements.test.mjs --testTimeout=30000
```

[The machine-readable inventory](ui-migration-consumers.json) records source paths, subsystem, line, full token with variants and opacity, consumer kind, and proposed replacement. Its counts are extraction records, not a removal threshold. Svelte class bindings can produce several alternatives at one consuming attribute. A shared script string can also have several consuming attributes.

The current ledger scans 1,894 sources and emits 2,535 records, including 113 unresolved records. The largest group is 1,068 script component candidates; these include ambiguous role, state, and native-element strings and must not be counted as confirmed class consumers.

The expanded scan includes host sources, all shared packages and bundled plugins, Storybook, executable fixtures/tests, scripts, root build scripts, HTML entrypoints, and package manifests. Generated output, dependencies, Rust targets, historical prose, website, and mobile sources are excluded. The lockfile remains an installed-dependency confirmation, not a class consumer. `src/app.css`, `src/styles/theme-adapter.css`, and the root daisyUI dependency are retained build inputs. The adapter also owns font aliases, global focus, compact control sizing, and reduced-motion behavior; its removal remains KVG-4874.

### Ownership and disposition

| Subsystem or path | Verification and replacement owner |
| --- | --- |
| `packages/plugin-sdk` | KVG-4865. Scoped SDK styles and existing/public feedback controls, not host utility dependencies. |
| `packages/pr-review-ui` | KVG-4866. Host-built semantic colors and SDK feedback. |
| `packages/terminal-runtime` and `plugins/terminal` | KVG-4867. Presentation only, no session/lifecycle changes. |
| `plugins/github-sync` | KVG-4868. Semantic colors and SDK controls. |
| `plugins/file-viewer` | KVG-4869. Semantic colors and SDK controls. |
| `plugins/task-browser` | KVG-4870. Semantic colors and SDK controls. |
| Host project setup and attention | KVG-4871. Preserve the already-migrated SDK controls. |
| Host task detail and self-review | KVG-4872. Presentation only. |
| Remaining host, stories and fixtures | KVG-4873, coordinated with the owning subsystem. Settings business logic remains excluded. |
| Compatibility definitions, stylesheet plugin inputs and dependency | KVG-4874, after consumer migration. |

`color` records are parsed class attributes/directives, class-forwarding props, selectors, or `@apply` consumers. `component` records include loading, alert and progress as well as the earlier control families. `color-variable` and `geometry-variable` identify reads; `compatibility-definition` identifies definitions that must stay installed now. A selector is not proof that matching markup is still mounted; for example, the review diff stylesheet's `.textarea` and `.btn` selectors must be checked against SDK-backed editor markup in KVG-4866.

Arbitrary utility variable references use `arbitrary-variable`, or `script-arbitrary-variable-candidate` when found in a script string. Variable-name occurrences are also reported separately.

`script-candidate`, `script-component-candidate`, and `script-variable-candidate` are parsed string producers or probes whose runtime use needs review. Markup, CSS selectors, `@apply`, and script strings share token classification, including component variants such as `hover:alert-error` and `md:loading-sm`. `unresolved` records deliberately retain mutable bindings, uncertain spread attributes, dynamic class forwarding, member access, helper calls, interpolated templates, script class producers, and parse failures. Only unique constant initializers can be resolved as local class bindings. Unresolved records are not treated as migrated. Do not infer zero consumers from a successful reporting command.

Explicit exclusions and false positives:

- `select-none`, `select-text`, `select-all`, `select-auto`, parsed native element names, comments, ordinary local classes, direct `--of-*` callers, and Tailwind palette variables are not legacy color dependencies. An ambiguous script string such as `'select'` stays a component candidate: it may be a native element name or a class producer.
- `scripts/check-ui-migration-inventory.test.mjs` contains intentional negative sources and expected results. Its records are scanner test evidence, not product migration work.
- The checker's own role/variable lookup strings are migration-tool definitions, not shipped styles.
- Other test and fixture records stay visible. Browser probes and executable fixture styles are real consumers; assertion strings require manual classification rather than a blanket test-directory exclusion.

### Count reconciliation

The planning design records 905 lexical references across 113 files, compared with KVG-4671's reported 929 across 113 files, a difference of 24. Neither source includes its exact scan command or per-occurrence ledger. These are historical observations, not equivalent parser inventories.

A reproduced lexical scan of the planning PR head `7b01bef2e8861731f4fb441c74daf1bca77d1032` and this worktree's base `58dbaf2df1b6d16dc0f80c3afa3f75675a566e88` produced the same 907 matches in 112 files. It used the existing guard's source exclusions and the families `bg|text|border|ring|outline|decoration|fill|stroke` against legacy roles in Svelte/CSS under `src`, `packages`, and `plugins`. There were no per-file count changes between these two refs under that definition. Changing fixture exclusions and including directional borders changes the result again. This disproves a claim that the 24-reference difference can simply be assigned to this ticket's changes.

The exact historical 24-reference attribution remains unresolved without the original commands or occurrence lists. The new ledger replaces neither count with an assumed target and exposes candidates/exclusions separately. Review that ledger, not a target of 905, before the final removal gate.

## Supported semantic utilities

`src/styles/semantic-utilities.css` supplies one Tailwind v4 inline `--color-of-*` namespace. `src/app.css` imports it alongside the unchanged compatibility adapter. No theme-schema fields, theme IDs, SDK exports, or unprefixed replacement aliases were added.

| Legacy role | Semantic role |
| --- | --- |
| `base-100`, `base-200`, `base-300`, `base-content` | `surface`, `surface-subtle`, `border`, `text` |
| `primary`, `accent` | `accent` |
| `primary-content`, `accent-content` | `on-accent` |
| `secondary`, `secondary-content` | `control`, `control-text` |
| `neutral`, `neutral-content` | `text`, `text-inverse` |
| `info`, `success`, `warning` and their content roles | Corresponding role and `on-info`, `on-success`, `on-warning` |
| `error`, `error-content` | `danger`, `on-danger` |

Use `bg-of-surface`, `text-of-text`, `border-of-border/50`, or `hover:bg-of-accent/10`. Preserve the entire variant chain and opacity suffix. For paint equivalence, `bg-base-300` becomes `bg-of-border`, not a redesigned surface role. Opacity applies to the color, not the element or its children. Existing correct direct-token classes remain supported and untouched.

These utilities exist where the host stylesheet is compiled. Production discovery tests seed distinct classes in PR review UI, terminal runtime, and all four affected bundled plugins, then verify emitted browser paint without an inline safelist. Current discovery works without additional source configuration. Standalone plugin-owned Tailwind builds must supply their own compilation setup or use direct tokens. SDK controls must remain self-contained and must not depend on this stylesheet.

The retained adapter's unlayered global `:focus-visible` outline rule takes precedence over layered outline utilities on focusable controls. The compiled-family matrix isolates the semantic definitions to verify their paint; host integration tests retain and exercise the adapter separately. No global focus rule was moved or weakened here.

See [validation and browser evidence](ui-migration-validation.md), [host computed baselines](ui-migration-baseline.json), and [token-only SDK baselines](ui-migration-sdk-baseline.json).

## Feedback controls, KVG-4864

The SDK now exports `LoadingIndicator`, `Alert`, and `Progress` through its canonical registry. `PluginViewState` no longer needs host utility CSS: it uses the feedback controls, SDK Button/Badge, and scoped styles. Its loading message has one polite announcement; errors and retry callbacks retain their existing policy.

The inventoried loading sizes are `xs` in inline actions/settings, `sm` in diff and provider loading, `md` in whole-view loading, and `lg` in `AgentTerminalShell`. Their bounds scale with `--of-control-height-compact`. Alerts retain one feedback density and progress one 0.5rem bar height. Other caller migrations, including `MermaidDiagramPreview`, remain with their owning tasks.

The machine-readable ledger above is the KVG-4863 snapshot, not a refreshed completion count. Its former `PluginViewState` loading, button, badge, color, and layout utility occurrences are superseded by this bounded migration. New public components and token-only fixtures contain no legacy style consumers. Historical browser measurements remain evidence, not executable host-CSS requirements.

See [feedback validation](ui-feedback-validation.md) for public test boundaries, baseline geometry, publication checks, and remaining validation gaps.
