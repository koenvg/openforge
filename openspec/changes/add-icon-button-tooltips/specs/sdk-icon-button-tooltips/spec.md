## Purpose

Make icon-only actions identifiable through consistent accessible tooltips across the host application and plugin interfaces, with configurable placement and restrained motion.

## ADDED Requirements

### Requirement: Opt-in tooltips for mixed text and icon controls
SDK Button SHALL offer opt-in shared tooltip behavior with the same placement configuration as IconButton. It SHALL default to disabled tooltip behavior and derive enabled tooltip text from its effective non-empty aria-label. Toggling tooltip configuration or changing visible labels SHALL preserve the native button, focus, text-control geometry, action callbacks, and disabled/loading semantics.

#### Scenario: Responsive control changes presentation
- **WHEN** an opted-in Button changes between a visible text label and an icon-only presentation
- **THEN** the same native button and its focus are retained
- **AND** keyboard focus or hover can reveal its accessible label through the shared tooltip

#### Scenario: Ordinary Button remains unchanged
- **WHEN** a Button is rendered without opting into tooltips
- **THEN** it does not open an SDK tooltip and retains normal native-title forwarding

#### Scenario: Opt-out while focused
- **WHEN** tooltip behavior is disabled while the Button is focused with its tooltip open
- **THEN** the tooltip closes without replacing or blurring the button

### Requirement: Automatic icon-button labels
SDK IconButton SHALL show a plain-text tooltip from its effective accessible label by default. Consumers SHALL be able to opt out without losing the button's accessible name. Label changes SHALL be reflected without stale tooltip text. Automatic tooltips SHALL NOT introduce a second focusable control or duplicate native title tooltip.

#### Scenario: Existing SDK consumer
- **WHEN** a consumer renders an enabled IconButton with a label and no tooltip configuration
- **THEN** hovering or keyboard-focusing the button reveals that label as a tooltip
- **AND** the button retains its accessible name and existing layout

#### Scenario: Opt-out
- **WHEN** the consumer disables the automatic tooltip
- **THEN** hover and focus do not open the SDK tooltip and the accessible name remains available

#### Scenario: Label update
- **WHEN** the effective label of an open tooltip's button changes
- **THEN** the tooltip displays the current label rather than the previous one

### Requirement: Per-button preferred placement
Consumers SHALL be able to configure preferred top, right, bottom, or left placement, start, center, or end alignment, and distance from the trigger. The default SHALL be top, center alignment, and a six-pixel gap. Placement SHALL adjust when the preferred position would clip the tooltip at the viewport edge. Long labels SHALL wrap within available space without changing button layout.

#### Scenario: Preferred placement has room
- **WHEN** a button requests right placement, start alignment, and a custom gap with sufficient space
- **THEN** the tooltip uses the requested position and spacing

#### Scenario: Preferred side would clip
- **WHEN** the preferred position would place tooltip content beyond the viewport
- **THEN** the tooltip shifts or changes side to remain visible

#### Scenario: Clipped container and long label
- **WHEN** an icon button inside a scrolling or overflow-hidden container has a long label
- **THEN** the tooltip remains readable outside that container's clipping boundary and wraps to available viewport width

### Requirement: Accessible interaction and dismissal
Tooltips SHALL open after a short pointer-hover delay and on keyboard focus, expose tooltip semantics, preserve existing descriptions, and never take focus from their button. Users SHALL be able to move the pointer onto an open tooltip without it immediately disappearing. Escape SHALL dismiss the tooltip without activating the button or dismissing a containing menu or dialog on that same keypress. Activation SHALL dismiss the tooltip while preserving the action's existing behavior. Touch activation SHALL NOT require an extra tap to dismiss or open a tooltip before performing the action.

#### Scenario: Hover and exit
- **WHEN** the pointer enters an enabled button and stays through the hover delay
- **THEN** its tooltip opens
- **AND** moving onto the tooltip keeps it visible until the pointer leaves both regions, unless the button remains focused

#### Scenario: Keyboard use inside an overlay
- **WHEN** a focused icon button in a menu or dialog has an open tooltip and the user presses Escape
- **THEN** only the tooltip closes, focus remains on the button, and the containing overlay remains open

#### Scenario: Existing description
- **WHEN** a button already references descriptive content and its tooltip opens
- **THEN** its existing description relationship and accessible name remain intact

#### Scenario: Activation
- **WHEN** a user clicks, keyboard-activates, or taps an enabled icon button
- **THEN** its action runs exactly once with unchanged event semantics and the tooltip does not obstruct the action

### Requirement: Disabled and loading compatibility
Disabled and loading icon buttons SHALL remain non-operable and SHALL NOT gain a focusable wrapper. Their automatic tooltips SHALL remain closed. A visible tooltip SHALL close when its trigger becomes disabled, starts loading, or is removed.

#### Scenario: Availability changes
- **WHEN** an icon button with an open tooltip becomes disabled or loading
- **THEN** the tooltip closes and attempted activation dispatches no action

#### Scenario: Trigger removal
- **WHEN** a button is removed while its tooltip is open or pending
- **THEN** no orphaned tooltip appears or remains visible

### Requirement: Overshoot motion and theme consistency
Tooltips SHALL use a subtle scale-and-directional-slide overshoot entrance and a quick non-overshooting exit. Motion SHALL follow the actual rendered side after collision adjustment and SHALL NOT move the trigger or surrounding layout. Reduced-motion preferences SHALL suppress scale, translation, and overshoot. Tooltip colors, typography, borders, and elevation SHALL use the SDK theme.

#### Scenario: Animated entrance
- **WHEN** a tooltip opens with normal motion preferences
- **THEN** it briefly overshoots its settled scale and position before settling, without moving nearby controls

#### Scenario: Reduced motion
- **WHEN** reduced motion is enabled
- **THEN** tooltip opening and closing contain no scale, slide, or bounce while interaction and placement remain unchanged

### Requirement: Shared SDK and application adoption
Host and built-in plugin icon-only action buttons SHALL use the shared automatic tooltip behavior or an explicit opt-out with a documented reason. Existing standalone SDK Tooltip consumers SHALL retain their public props and trigger behavior. Plugin consumers SHALL receive the feature through published SDK imports without host-internal imports.

#### Scenario: Plugin usage
- **WHEN** a plugin imports IconButton from the published SDK and supplies its label and preferred placement
- **THEN** it receives the same tooltip behavior and appearance as the host application

#### Scenario: Existing custom label presentation
- **WHEN** an existing icon-only action is migrated from a native title or custom tooltip
- **THEN** only one tooltip is displayed and any useful existing label or shortcut information is retained in its accessible label

#### Scenario: Standalone compatibility
- **WHEN** an existing consumer uses the standalone Tooltip's label, content, trigger, controlled open state, and callbacks
- **THEN** it retains those supported behaviors after the automatic icon-button feature is introduced
