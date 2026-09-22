## Context

See `proposal.md` for the motivation and `specs/mobile-task-prompt-suggestions/spec.md` for the behavior contract. `TaskCreationSheet` currently places the bounded suggestion `ListView` after a five-line `TextField` inside a `SingleChildScrollView`. The sheet uses `isScrollControlled`, and its bottom padding includes `MediaQuery.viewInsetsOf(context).bottom`. Matching, catalog loading, and insertion already work for the provider's `/` or `$` trigger. The problem is placement and keyboard-aware visibility, not the catalog contract.

## Goals / Non-Goals

**Goals:** Keep the prompt and a selectable suggestion together above the on-screen keyboard on a small phone. Preserve the existing sheet's styling, list content, and provider behavior.

**Non-Goals:** Change desktop autocomplete, provider catalog APIs, task creation, or unrelated Create Task controls.

## Decisions

1. Move the existing suggestion list immediately before the prompt field in the sheet's content order, rather than using a floating overlay. This gives the list a stable reading and accessibility order, avoids covering the project details, and keeps tap and scroll behavior inside the sheet. An overlay anchored to the field would require extra positioning and clipping handling around the keyboard and sheet edges.
2. Bound the list using the space available above the keyboard, rather than relying only on its current fixed 240-pixel maximum. Keep the sheet scrollable, allow the list to scroll independently when it has more matches, and bring the picker/prompt region into view as matching results or keyboard insets change. Do not reduce the prompt to an unusable size or assume the header fits on every phone. Merely reordering the children without managing viewport space would still leave suggestions hidden on compact screens.
3. Retain the existing `ListTile` content, theme colors, kind icons, source labels, and tap-to-insert code. Use the existing spacing tokens and a compact bounded list; avoid a redesign of the whole sheet. The row remains a full-width touch target, including when descriptions wrap. Keep the existing provider-trigger filter and stale-result guard untouched except where needed to keep the picker visibility in sync with layout changes.

## Risks / Trade-offs

- [Nested scrolling between the sheet and suggestion list] -> Constrain the list height and test scrolling both the list and the sheet on a small viewport.
- [Keyboard animation or asynchronous catalog results can move the input] -> Verify layout after the keyboard inset and result count change, including that the prompt and a tappable result remain visible together.
- [Larger text can consume the available list height] -> Test text scaling and wrapping without clipped labels or inaccessible rows.
