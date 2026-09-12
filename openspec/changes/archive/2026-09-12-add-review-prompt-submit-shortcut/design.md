## Context

See proposal.md for motivation. `SendToAgentPanel.svelte` owns the draft, mode, and `confirmSend()` action. Its existing guard prevents sending whitespace-only drafts or sending while the agent is running or paused. The SDK Modal already exposes `onKeydown`; returning true prevents default behavior and stops propagation. The dialog initially focuses its textarea.

A short design is useful here to resolve keyboard event ownership and prevent differences between button and shortcut submission.

## Goals / Non-Goals

**Goals:**
- Keep one submission path and one owner of dialog keyboard events.
- Exercise user-visible behavior through the existing component-test boundary.

**Non-Goals:**
- No global shortcut registration or shared Modal API changes.
- No changes to prompt generation, captured-comment matching, async dispatch contracts, or unrelated dialog styling.

## Decisions

### Handle the shortcut through this Modal instance

Pass a local handler to Modal's existing `onKeydown` prop. This covers focus on the textarea and other dialog controls without a window listener. A textarea-only listener would miss focused buttons; a global listener would require additional focus and lifetime coordination.

Recognize Enter with the platform submit modifier, without Alt or Shift. There is no existing renderer platform helper, so detect macOS locally from `navigator.platform` and use that same result for matching and display. Command is the advertised modifier on macOS; Ctrl is the advertised modifier on Windows/Linux. No additional cross-platform aliases are required.

Ignore composition and repeated keydown events. For a recognized normal shortcut, call `confirmSend()` and return true even if its guard blocks sending, so the keystroke cannot become a newline or an enclosing action. Do not duplicate dispatch or comment cleanup. Preserve the exact draft rather than trimming the sent value.

### Keep the hint adjacent to the action

Add a compact platform-specific keyboard hint beside the Send to agent label, using existing project UI conventions. Keep the label intact and allow the action area to fit constrained widths without hiding Cancel or mode controls. A tooltip alone was rejected because users should see the shortcut without hovering.

### Test the component through events and callbacks

Extend `SendToAgentPanel.test.ts` using the real Modal where the existing test setup permits. Open the dialog, edit its draft, dispatch keyboard events at focused descendants, and assert the send callback and visible dialog state. Cover both platforms and modes, exact edited text, empty drafts, busy-state changes after opening, focus scope, composition, repeat, additional modifiers, and event consumption. Retain existing button and comment-handling tests.

Synthetic keyboard events do not prove native textarea newline insertion. Confirm multiline editing and shortcut behavior in a running UI, and inspect the hint at typical and constrained widths rather than using style assertions as behavioral tests.

## Risks / Trade-offs

- Shortcut propagation could trigger an enclosing action. Mitigation: consume recognized shortcuts through Modal and test propagation, including blocked sends.
- A shortcut could bypass a recently changed busy state. Mitigation: reuse the current `confirmSend()` guard and test status changes while the dialog is open.
- Platform detection could make hints disagree with handling. Mitigation: derive both from the same local platform check and test both branches.
- Additional hint text could crowd the footer. Mitigation: visually check constrained widths before full validation, without redesigning the dialog.

## Migration Plan

No migration or new dependency is required. Ship as a renderer-only change. Reverting the local handler, hint, and associated tests restores click-only submission without changing persisted data.
