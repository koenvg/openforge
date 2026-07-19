# Attention Overview: One-Handed Keyboard Shortcuts

**Date:** 2026-07-19
**Status:** Approved for planning

## Problem

The attention overview dialog is bound to `⌘⇧A`. That is a three-key chord on the far
left of the keyboard, so it requires the left hand.

While dictating, the user's left hand is frequently unavailable and only the right hand is
free. There is currently no way to open the attention overview without the left hand, and
`⌘⇧A` is slow even when both hands are free because it is a three-key chord.

## Goal

Make `toggleAttentionOverview` reachable by either hand alone, using a two-key chord in
both cases.

Explicit non-goals:

- No trackpad gesture capture. Three-finger swipe up is bound to Mission Control on macOS
  (`TrackpadThreeFingerVertSwipeGesture = 2`), the OS consumes it before any app sees it,
  and Chromium never surfaces it to JS. Global gesture capture would require an
  Objective-C++ native addon using Accessibility permissions or the private
  `MultitouchSupport.framework`. Out of scope, and unnecessary: `⌘⇧A` is an in-renderer
  shortcut, so no global capture is involved at all.
- No IconRail click target. Considered and deferred; the two chords are expected to be
  sufficient on their own.
- No mouse side-button binding. Considered and deferred; it is hardware-dependent and mouse
  drivers commonly intercept buttons 3/4 before they reach the renderer.

## Design

### Bindings

`src/lib/appShortcutDefinitions.ts`, `attention-overview` entry:

```ts
{
  id: 'attention-overview',
  registrations: [
    { key: '⌘E', action: 'toggleAttentionOverview' },  // left hand
    { key: '⌘;', action: 'toggleAttentionOverview' },  // right hand
  ],
  help: {
    id: 'attention-overview',
    label: 'Attention overview',
    keys: [['⌘', 'E'], ['⌘', ';']],
  },
}
```

`⌘⇧A` is removed.

This needs no new machinery. `AppShortcutDefinition.registrations` is already a list, and
multiple registrations per action are an established pattern — `go-back` has four, and
`voice-input` has both `⌘D` and `⌃D`. Both new chords dispatch through the existing
`runAppShortcutAction` in `src/lib/appShortcuts.ts`.

### Why `⌘E` for the left hand

Left-hand keys are `QWERT / ASDFG / ZXCVB / 1-5`. Eliminating:

- **Already bound in-app:** `⌘B` `⌘D` `⌘1` `⌘2` `⌘3` `⌘4`
- **Reserved by macOS/Chromium:** `⌘A` (select all), `⌘C` `⌘V` `⌘X` (clipboard), `⌘F`
  (find), `⌘G` (find next), `⌘Q` (quit), `⌘R` (reload), `⌘S` (save), `⌘T` (new tab), `⌘W`
  (close), `⌘Z` (undo)

`⌘E` is the only remaining clean left-hand `⌘`+letter. It is an Edit-menu convention ("Use
Selection for Find"), not a hard system binding, so it is free in an Electron app that does
not define that menu item. `⌘5` is the only other free left-hand key.

`⌘E` has no mnemonic relationship to "attention". It is chosen on availability.

### Why `⌘`+letter and not `⌥`+letter

`⌥`+letter chords cannot work in this registry. `physicalShortcutKeysByCode` in
`src/lib/shortcuts.svelte.ts` maps only digits and punctuation — no letters — so letter
chords match on `e.key`. On macOS, holding `⌥` mutates `e.key` into a special character
(`⌥A` → `å`), and there is no physical-code fallback for letters. The chord would never
match.

`⌘;` is safe on both paths: `Semicolon` is present in `physicalShortcutKeysByCode`, and
`e.key` for `;` is `;` regardless.

### Help renderer fix

`src/App.svelte` renders help keys with nested loops and no separator between sequences:

```svelte
{#each shortcut.keys as keySequence}
  {#each keySequence as key}
    <kbd class="kbd kbd-sm">{key}</kbd>
```

`ShortcutHelpEntry.keys` is typed `readonly (readonly string[])[]` — a list of alternative
sequences — but the renderer flattens them. With two sequences, `[['⌘','E'], ['⌘',';']]`
renders as four adjacent chips (`⌘ E ⌘ ;`), reading as one nonsensical four-key chord
rather than two alternatives.

No existing entry has more than one sequence, so this has never surfaced.

Fix: render a separator between sequences (not between keys within a sequence), so
alternatives read as `⌘ E or ⌘ ;`. This also corrects `go-back`, which has four
registrations but advertises only `⌘[`.

### Action palette

`getPrimaryAppShortcutKey` returns `registrations[0].key`, so the action palette will
display `⌘E`. `⌘E` is listed first deliberately: it is the direct replacement for `⌘⇧A`.

## Testing

Per project convention, tests cover business logic only — no assertions on CSS classes or
styling.

1. `src/lib/appShortcuts.test.ts:47` asserts help entries with `toEqual` and will fail on
   the new `keys` shape. Update it first (TDD), then change the definition.
2. Assert both `⌘E` and `⌘;` dispatch `toggleAttentionOverview` through
   `registerAppShortcuts`.
3. Assert `⌘⇧A` no longer dispatches.
4. Assert `getPrimaryAppShortcutKey('attention-overview')` returns `⌘E`.
5. For the help renderer, assert the rendered structure distinguishes two alternative
   sequences — assert on the separator text and key grouping, not on styling.

## Risks

- **`⌘E` collides with a user habit or a future Edit menu item.** Low impact and trivially
  reversible: change one line in the definitions array.
- **Muscle memory for `⌘⇧A`.** Removing it is an explicit decision. Re-adding it as a third
  registration is a one-line change if the transition proves annoying.
